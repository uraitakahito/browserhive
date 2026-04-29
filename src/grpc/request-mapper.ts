/**
 * Request Mapper (Inbound)
 *
 * Converts Proto types to domain types for incoming gRPC requests.
 * Performs validation and constructs CaptureTask from CaptureRequest.
 */
import { randomUUID } from "node:crypto";
import type {
  CaptureRequest,
  CaptureOptions as ProtoCaptureOptions,
} from "./generated/browserhive/v1/capture.js";
import {
  validateCaptureOptions,
  validateFilename,
  validateLabels,
} from "../capture/index.js";
import type { CaptureTask, CaptureOptions } from "../capture/index.js";
import { err, ok, type Result } from "../result.js";

const captureOptionsFromProto = (
  proto: ProtoCaptureOptions | undefined
): CaptureOptions => {
  if (!proto) {
    return { png: false, jpeg: false, html: false };
  }

  return {
    png: proto.png,
    jpeg: proto.jpeg,
    html: proto.html,
  };
};

/**
 * Convert a CaptureRequest to a CaptureTask with validation.
 *
 * Validation order matches the original handlers.ts:
 * 1. URL empty check
 * 2. captureOptions convert + validate
 * 3. labels trim/filter + validate
 * 4. correlationId validate
 * 5. UUID generation + task construction
 */
export const captureRequestToTask = (
  request: CaptureRequest
): Result<CaptureTask, string> => {
  if (!request.url || request.url.trim() === "") {
    return err("url is required");
  }

  const captureOptions = captureOptionsFromProto(request.capture_options);
  const optionsValidation = validateCaptureOptions(captureOptions);
  if (!optionsValidation.ok) {
    return err(optionsValidation.error);
  }

  const trimmedLabels = request.labels.map((l) => l.trim()).filter((l) => l !== "");
  if (trimmedLabels.length > 0) {
    const labelsValidation = validateLabels(trimmedLabels);
    if (!labelsValidation.ok) {
      return err(labelsValidation.error);
    }
  }

  if (request.correlation_id) {
    const correlationIdValidation = validateFilename(request.correlation_id);
    if (!correlationIdValidation.ok) {
      return err(correlationIdValidation.error);
    }
  }

  const taskId = randomUUID();
  const task: CaptureTask = {
    taskId,
    labels: trimmedLabels,
    url: request.url.trim(),
    retryCount: 0,
    captureOptions,
    ...(request.correlation_id && { correlationId: request.correlation_id }),
  };

  return ok(task);
};
