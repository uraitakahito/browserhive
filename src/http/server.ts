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
 *   - At startup we dereference the document with @apidevtools/swagger-parser
 *     and feed each route's request body / response schemas to Fastify's
 *     `schema` option. Fastify's Ajv enforces them.
 *   - Domain-level invariants (e.g. "at least one capture option must be
 *     true", filename safety for labels) live in src/http/request-mapper.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import SwaggerParser from "@apidevtools/swagger-parser";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";
import type { CaptureCoordinator } from "../capture/index.js";
import type { TlsConfig } from "../config/index.js";
import { logger } from "../logger.js";
import { createCaptureHandlers } from "./handlers.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..", "..");
const OPENAPI_PATH = join(projectRoot, "src", "http", "openapi.yaml");

interface PathItem {
  post?: OperationObject;
  get?: OperationObject;
}

interface OperationObject {
  operationId?: string;
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema: unknown }> }>;
}

interface OpenApiDocument {
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown> };
}

const extractRouteSchema = (
  operation: OperationObject | undefined,
): {
  body?: unknown;
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

  return {
    response,
    ...(bodySchema !== undefined && { body: bodySchema }),
  };
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
    // ajv-formats and the Fastify-bundled Ajv resolve to different package
    // versions on disk (root ajv@v6, fastify-internal ajv@v8), so direct
    // type assignment is not possible. The runtime call still works because
    // Fastify only invokes the plugin against its own Ajv instance.
    //
    // `removeAdditional: false` overrides Fastify's default (`true`) so that
    // `additionalProperties: false` in the OpenAPI schema causes a 400 on
    // unknown fields, instead of silently stripping them before validation.
    // Treating the spec as a strict contract is the point of going OpenAPI-first.
    const ajvOptions = {
      customOptions: {
        strict: false,
        allErrors: true,
        removeAdditional: false,
      },
      plugins: [addFormats as unknown as never],
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

    const document = (await SwaggerParser.dereference(
      OPENAPI_PATH,
    )) as OpenApiDocument;

    await app.register(fastifySwagger, {
      mode: "static",
      specification: { document: document as unknown as OpenAPIV3.Document },
    });
    await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

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

    const submitOperation = document.paths["/v1/captures"]?.post;
    const submitSchema = extractRouteSchema(submitOperation);
    app.post(
      "/v1/captures",
      {
        schema: {
          ...(submitSchema.body !== undefined && { body: submitSchema.body }),
          response: submitSchema.response,
        },
      },
      handlers.submitCapture,
    );

    const statusOperation = document.paths["/v1/status"]?.get;
    const statusSchema = extractRouteSchema(statusOperation);
    app.get(
      "/v1/status",
      { schema: { response: statusSchema.response } },
      handlers.getStatus,
    );
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
