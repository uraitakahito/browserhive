/**
 * HTTP Handlers
 *
 * Request handlers for the Capture API. Uses Fastify's request/reply
 * model. Schema-level validation is handled by Fastify's Ajv before the
 * handler runs; handlers only enforce coordinator state and domain
 * validation that cannot be expressed in JSON Schema.
 *
 * Failure responses use RFC 7807 Problem Details
 * (Content-Type: application/problem+json) instead of a
 * `{ accepted: false }` envelope on the success path.
 */
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import type { CaptureCoordinator } from "../capture/index.js";
import { createChildLogger } from "../logger.js";
import type { CaptureRequest, Problem } from "./generated/index.js";
import type { OperationId } from "./generated/operations.gen.js";
import {
  duplicateUrlProblem,
  noOperationalWorkersProblem,
  validationProblem,
} from "./error-mapper.js";
import { captureRequestToTask } from "./request-mapper.js";
import {
  coordinatorStatusToResponse,
  taskToAcceptance,
} from "./response-mapper.js";

const PROBLEM_CONTENT_TYPE = "application/problem+json";

const sendProblem = (
  reply: FastifyReply,
  problem: Problem,
): FastifyReply =>
  reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);

/**
 * Handler map keyed by operationId. Using `Record<OperationId, …>` makes a
 * mismatch between the YAML spec and the handler implementation a compile
 * error: renaming an operationId in `openapi.yaml` regenerates
 * `OperationId`, which then forces this map to be updated in lock-step.
 */
export type CaptureHandlers = Record<OperationId, RouteHandlerMethod>;

export const createCaptureHandlers = (
  coordinator: CaptureCoordinator,
): CaptureHandlers => {
  const handlerLogger = createChildLogger({ handler: "submitCapture" });

  const submitCapture: RouteHandlerMethod = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply => {
    const body = request.body as CaptureRequest;
    const result = captureRequestToTask(body);

    if (!result.ok) {
      return sendProblem(reply, validationProblem(result.error));
    }

    if (!coordinator.isActive || coordinator.operationalWorkerCount === 0) {
      return sendProblem(reply, noOperationalWorkersProblem());
    }

    const task = result.value;
    const enqueueResult = coordinator.enqueueTask(task);
    if (!enqueueResult.ok) {
      return sendProblem(reply, duplicateUrlProblem(enqueueResult.error));
    }

    handlerLogger.info(
      {
        taskLabels: task.labels,
        taskId: task.taskId,
        ...(task.correlationId && { correlationId: task.correlationId }),
        captureFormats: task.captureFormats,
        dismissBanners: task.dismissOptions !== undefined,
        ...(task.acceptLanguage && { acceptLanguage: task.acceptLanguage }),
        url: task.url,
      },
      "Capture request accepted",
    );

    return reply.code(202).send(taskToAcceptance(task));
  };

  const getStatus: RouteHandlerMethod = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply => {
    // Fastify's Ajv coerces the string query into `number` and applies the
    // OpenAPI `default: 50`. A redundant `?? 50` in coordinator.getStatus
    // backstops cases where this handler is invoked without the schema
    // (e.g. the unit tests in test/http/handlers.test.ts wire the route
    // directly without registerOperation).
    const pendingLimit = (request.query as { pendingLimit?: number })
      .pendingLimit;
    return reply
      .code(200)
      .send(
        coordinatorStatusToResponse(
          coordinator.getStatus({
            ...(pendingLimit !== undefined && { pendingLimit }),
          }),
        ),
      );
  };

  return { submitCapture, getStatus };
};
