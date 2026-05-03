/**
 * HTTP Server
 *
 * Fastify-based HTTP transport for the Capture API. Owns route
 * registration, validation wiring, and graceful shutdown; the
 * CaptureCoordinator is injected so the same coordinator instance can
 * be reused across server lifecycles in tests.
 *
 * Validation strategy:
 *   - openapi.yaml is the single source of truth.
 *   - At build time `scripts/openapi-bundle.mjs` dereferences the spec
 *     and writes `dist/openapi.dereferenced.json`. The runtime server
 *     reads that JSON and feeds each route's request body / response
 *     schemas to Fastify's `schema` option. Fastify's Ajv enforces them.
 *   - The source YAML and `@apidevtools/swagger-parser` are not present
 *     in the production image — the runtime only sees the pre-resolved
 *     JSON.
 *   - Domain-level invariants (e.g. "at least one capture format must be
 *     true", filename safety for labels) live in src/http/request-mapper.ts.
 *
 * Documentation:
 *   - The Redoc-rendered reference docs are no longer served by this
 *     process. They are published as a static artifact (see
 *     `.github/workflows/docs.yml`); the running server has no
 *     `/docs` or `/openapi.yaml` endpoint.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, {
  type FastifyInstance,
  type FastifyError,
} from "fastify";
import type { CaptureCoordinator } from "../capture/index.js";
import type { TlsConfig } from "../config/index.js";
import { logger } from "../logger.js";
import { INLINE_FORMATS } from "./ajv-formats-inline.js";
import { createCaptureHandlers, type CaptureHandlers } from "./handlers.js";
import {
  OPERATIONS,
  type OperationId,
  type OperationMethod,
} from "./generated/operations.gen.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..", "..");
const DEREFERENCED_SPEC_PATH = join(
  projectRoot,
  "dist",
  "openapi.dereferenced.json",
);

const readDereferencedSpec = (): OpenApiDocument => {
  try {
    const raw = readFileSync(DEREFERENCED_SPEC_PATH, "utf-8");
    return JSON.parse(raw) as OpenApiDocument;
  } catch (error) {
    throw new Error(
      `Dereferenced OpenAPI spec not found at ${DEREFERENCED_SPEC_PATH}. Run \`npm run openapi:bundle\` (or \`npm run build\`) first.`,
      { cause: error },
    );
  }
};

type PathItem = Partial<Record<OperationMethod, OperationObject>>;

interface ParameterObject {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: unknown;
}

interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema: unknown }> }>;
}

interface OpenApiDocument {
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown> };
}

/**
 * Synthesize a JSON Schema object from the operation's `in: query` parameters.
 * Returns `undefined` when there are none, so callers can omit the
 * `querystring` key entirely (Fastify's Ajv treats omitted as "no validation").
 */
const extractQuerystringSchema = (
  operation: OperationObject,
): Record<string, unknown> | undefined => {
  const queryParams = (operation.parameters ?? []).filter((p) => p.in === "query");
  if (queryParams.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of queryParams) {
    if (param.schema !== undefined) {
      properties[param.name] = param.schema;
    }
    if (param.required) required.push(param.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: false,
  };
};

const extractRouteSchema = (
  operation: OperationObject | undefined,
): {
  body?: unknown;
  querystring?: unknown;
  response: Record<number, unknown>;
} => {
  const response: Record<number, unknown> = {};
  if (!operation) return { response };

  for (const [statusCode, def] of Object.entries(operation.responses ?? {})) {
    const content = def.content;
    if (!content) continue;
    const jsonSchema =
      content["application/json"]?.schema ??
      content["application/problem+json"]?.schema;
    if (jsonSchema !== undefined) {
      response[parseInt(statusCode, 10)] = jsonSchema;
    }
  }

  const bodySchema =
    operation.requestBody?.content["application/json"]?.schema;
  const querystringSchema = extractQuerystringSchema(operation);

  return {
    response,
    ...(bodySchema !== undefined && { body: bodySchema }),
    ...(querystringSchema !== undefined && { querystring: querystringSchema }),
  };
};

/**
 * Bind one operation from `OPERATIONS` to its handler. Path / method come
 * from the build-time generated map (see scripts/generate-operations.mjs);
 * the schema is pulled from the dereferenced document at runtime. The HTTP
 * method is upper-cased for Fastify's `app.route` API.
 */
const registerOperation = (
  app: FastifyInstance,
  document: OpenApiDocument,
  operationId: OperationId,
  handlers: CaptureHandlers,
): void => {
  const op = OPERATIONS[operationId];
  const operation = document.paths[op.path]?.[op.method];
  const schema = extractRouteSchema(operation);
  app.route({
    method: op.method.toUpperCase(),
    url: op.path,
    schema: {
      ...(schema.body !== undefined && { body: schema.body }),
      ...(schema.querystring !== undefined && { querystring: schema.querystring }),
      response: schema.response,
    },
    handler: handlers[operationId],
  });
};

export interface HttpServerConfig {
  port: number;
  tls?: TlsConfig;
}

/**
 * Hard timeout for `fastify.close()`. If the server cannot drain
 * in-flight requests within this window we resolve anyway and let the
 * parent process apply its own hard exit.
 */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 4000;

export class HttpServer {
  private app: FastifyInstance | null = null;
  private coordinator: CaptureCoordinator;
  private config: HttpServerConfig;

  constructor(coordinator: CaptureCoordinator, config: HttpServerConfig) {
    this.coordinator = coordinator;
    this.config = config;
  }

  private buildFastify(): FastifyInstance {
    // `removeAdditional: false` overrides Fastify's default (`true`) so that
    // `additionalProperties: false` in the OpenAPI schema causes a 400 on
    // unknown fields, instead of silently stripping them before validation.
    // Treating the spec as a strict contract is the point of going OpenAPI-first.
    const ajvOptions = {
      customOptions: {
        strict: false,
        allErrors: true,
        removeAdditional: false,
        formats: INLINE_FORMATS,
      },
    };

    const tls = this.config.tls;
    const httpsOptions = tls?.enabled
      ? {
          cert: readFileSync(tls.certPath),
          key: readFileSync(tls.keyPath),
        }
      : undefined;

    if (httpsOptions) {
      logger.info({ certPath: tls?.certPath }, "Starting server with TLS");
    } else {
      logger.info("Starting server in insecure mode");
    }

    const opts = {
      logger: false,
      ajv: ajvOptions,
      ...(httpsOptions && { https: httpsOptions }),
    };

    return Fastify(opts as never) as unknown as FastifyInstance;
  }

  async initialize(): Promise<void> {
    await this.coordinator.initialize();

    const app = this.buildFastify();
    this.app = app;

    const document = readDereferencedSpec();

    // Convert Fastify's default validation error envelope into our
    // RFC 7807 Problem shape so the response matches the OpenAPI 400 schema.
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).type("application/problem+json").send({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `Route ${request.method}:${request.url} not found`,
      }),
    );

    app.setErrorHandler((error: FastifyError, _request, reply) => {
      if (error.validation) {
        const detail =
          error.validation
            .map((v) => `${v.instancePath || "<root>"} ${v.message ?? ""}`.trim())
            .join("; ") || error.message;
        return reply.code(400).type("application/problem+json").send({
          type: "about:blank",
          title: "Validation failed",
          status: 400,
          detail,
        });
      }
      const status = error.statusCode ?? 500;
      return reply.code(status).type("application/problem+json").send({
        type: "about:blank",
        title: status >= 500 ? "Internal Server Error" : "Request error",
        status,
        detail: error.message,
      });
    });

    const handlers = createCaptureHandlers(this.coordinator);

    for (const operationId of Object.keys(OPERATIONS) as OperationId[]) {
      registerOperation(app, document, operationId, handlers);
    }
  }

  async start(): Promise<void> {
    if (!this.app) {
      throw new Error("HttpServer.initialize() must be called before start()");
    }
    const address = await this.app.listen({
      port: this.config.port,
      host: "0.0.0.0",
    });
    logger.info(
      {
        address,
        port: this.config.port,
        tls: this.config.tls?.enabled ?? false,
      },
      "HTTP server started",
    );
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down HTTP server");
    await this.coordinator.shutdown();

    const app = this.app;
    if (!app) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.warn(
          { timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
          "fastify.close() timed out, proceeding",
        );
        resolve();
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      app.close().then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          logger.info("HTTP server shut down");
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          logger.error({ err: error }, "Error during HTTP server shutdown");
          resolve();
        },
      );
    });
  }
}
