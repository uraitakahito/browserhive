/**
 * Request Mapper (Inbound)
 *
 * Converts validated HTTP request bodies to domain types. Schema-level
 * validation (required fields, types, formats) is handled by Fastify's
 * Ajv validator before this mapper runs; this layer only enforces
 * domain-specific invariants that cannot be expressed in JSON Schema:
 *
 *   - At least one capture option must be true.
 *   - Labels and correlationId must satisfy filename safety rules.
 *
 * Returns Result<CaptureTask, string> so handlers can branch into 400
 * Problem responses without exceptions for the validation path.
 */
import { randomUUID } from "node:crypto";
import {
  validateCaptureOptions,
  validateFilename,
  validateLabels,
} from "../capture/index.js";
import type { CaptureTask } from "../capture/index.js";
import { err, ok, type Result } from "../result.js";
import type { components } from "./generated/types.js";

type CaptureRequest = components["schemas"]["CaptureRequest"];

export const captureRequestToTask = (
  request: CaptureRequest,
): Result<CaptureTask, string> => {
  const url = request.url.trim();
  if (url === "") {
    return err("url is required");
  }

  const captureOptions = request.captureOptions;
  const optionsValidation = validateCaptureOptions(captureOptions);
  if (!optionsValidation.ok) {
    return err(optionsValidation.error);
  }

  const trimmedLabels = request.labels
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (trimmedLabels.length > 0) {
    const labelsValidation = validateLabels(trimmedLabels);
    if (!labelsValidation.ok) {
      return err(labelsValidation.error);
    }
  }

  if (request.correlationId !== undefined && request.correlationId !== "") {
    const correlationIdValidation = validateFilename(request.correlationId);
    if (!correlationIdValidation.ok) {
      return err(correlationIdValidation.error);
    }
  }

  const taskId = randomUUID();
  const task: CaptureTask = {
    taskId,
    labels: trimmedLabels,
    url,
    retryCount: 0,
    captureOptions,
    dismissBanners: request.dismissBanners,
    ...(request.correlationId !== undefined &&
      request.correlationId !== "" && {
        correlationId: request.correlationId,
      }),
  };

  return ok(task);
};
