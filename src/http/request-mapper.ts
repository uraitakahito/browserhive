/**
 * Request Mapper (Inbound)
 *
 * Converts validated HTTP request bodies to domain types. Schema-level
 * validation (required fields, types, formats) is handled by Fastify's
 * Ajv validator before this mapper runs; this layer only enforces
 * domain-specific invariants that cannot be expressed in JSON Schema:
 *
 *   - At least one capture format must be true.
 *   - Labels and correlationId must satisfy filename safety rules.
 *
 * Returns Result<CaptureTask, string> so handlers can branch into 400
 * Problem responses without exceptions for the validation path.
 */
import { randomUUID } from "node:crypto";
import {
  validateCaptureFormats,
  validateFilename,
  validateLabels,
} from "../capture/index.js";
import type { CaptureTask } from "../capture/index.js";
import { err, ok, type Result } from "../result.js";
import type { CaptureRequest } from "./generated/index.js";

export const captureRequestToTask = (
  request: CaptureRequest,
): Result<CaptureTask, string> => {
  const url = request.url.trim();
  if (url === "") {
    return err("url is required");
  }

  const captureFormats = request.captureFormats;
  const formatsValidation = validateCaptureFormats(captureFormats);
  if (!formatsValidation.ok) {
    return err(formatsValidation.error);
  }

  const trimmedLabels = (request.labels ?? [])
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
    captureFormats,
    dismissBanners: request.dismissBanners ?? false,
    ...(request.correlationId !== undefined &&
      request.correlationId !== "" && {
        correlationId: request.correlationId,
      }),
  };

  return ok(task);
};
