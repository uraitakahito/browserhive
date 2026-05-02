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
import type { components } from "./generated/types.js";
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

type CaptureRequest = components["schemas"]["CaptureRequest"];

const sendProblem = (
  reply: FastifyReply,
  problem: components["schemas"]["Problem"],
): FastifyReply =>
  reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);

export interface CaptureHandlers {
  submitCapture: RouteHandlerMethod;
  getStatus: RouteHandlerMethod;
}

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
        captureOptions: task.captureOptions,
        dismissBanners: task.dismissBanners,
        url: task.url,
      },
      "Capture request accepted",
    );

    return reply.code(202).send(taskToAcceptance(task));
  };

  const getStatus: RouteHandlerMethod = (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply =>
    reply.code(200).send(coordinatorStatusToResponse(coordinator.getStatus()));

  return { submitCapture, getStatus };
};
