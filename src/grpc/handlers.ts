/**
 * gRPC Handlers
 *
 * Request handlers for CaptureService RPCs.
 * Uses fire-and-forget pattern: enqueues tasks and returns immediately.
 */
import { randomUUID } from "node:crypto";
import { status as grpcStatus } from "@grpc/grpc-js";
import type * as grpc from "@grpc/grpc-js";
import type { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import type { CaptureRequest, CaptureAcceptance, Empty, StatusResponse } from "./generated/browserhive/v1/capture.js";
import {
  captureOptionsFromProto,
  validateCaptureOptions,
  workerStatusToProto,
  errorTypeToProto,
  validateFilename,
  validateLabels,
} from "../capture/index.js";
import type { CaptureTask, WorkerPool } from "../capture/index.js";
import { createChildLogger } from "../logger.js";

/** Create handlers for CaptureService */
export const createCaptureServiceHandlers = (workerPool: WorkerPool) => {
  /**
   * SubmitCapture RPC handler
   *
   * Enqueues capture task and returns immediately (fire-and-forget).
   * The actual capture is processed asynchronously by the worker pool.
   */
  const submitCapture: grpc.handleUnaryCall<CaptureRequest, CaptureAcceptance> = (
    call: ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
    callback: sendUnaryData<CaptureAcceptance>
  ) => {
    const request = call.request;

    if (!request.url || request.url.trim() === "") {
      callback(null, {
        accepted: false,
        task_id: "",
        error: "url is required",
      });
      return;
    }

    // Convert Proto CaptureOptions to TypeScript CaptureOptions
    const captureOptions = captureOptionsFromProto(request.capture_options);
    const optionsValidation = validateCaptureOptions(captureOptions);
    if (!optionsValidation.valid) {
      callback(null, {
        accepted: false,
        task_id: "",
        error: optionsValidation.error,
      });
      return;
    }

    const trimmedLabels = request.labels.map((l) => l.trim()).filter((l) => l !== "");
    if (trimmedLabels.length > 0) {
      const labelsValidation = validateLabels(trimmedLabels);
      if (!labelsValidation.valid) {
        callback(null, {
          accepted: false,
          task_id: "",
          error: labelsValidation.error,
        });
        return;
      }
    }

    if (request.correlation_id) {
      const correlationIdValidation = validateFilename(request.correlation_id);
      if (!correlationIdValidation.valid) {
        callback(null, {
          accepted: false,
          task_id: "",
          error: correlationIdValidation.error,
        });
        return;
      }
    }

    if (!workerPool.isRunning || workerPool.healthyWorkerCount === 0) {
      callback({
        code: grpcStatus.UNAVAILABLE,
        message: "No healthy workers available",
      });
      return;
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

    // Enqueue task (fire-and-forget)
    const enqueueResult = workerPool.enqueueTask(task);

    if (!enqueueResult.success) {
      callback(null, {
        accepted: false,
        task_id: "",
        error: enqueueResult.error,
      });
      return;
    }

    const requestLogger = createChildLogger({ handler: "submitCapture" });
    requestLogger.info(
      {
        taskLabels: task.labels,
        taskId: task.taskId,
        ...(task.correlationId && { correlationId: task.correlationId }),
        captureOptions: task.captureOptions,
        url: task.url,
      },
      "Capture request accepted"
    );

    // Return immediately with acceptance confirmation
    callback(null, {
      accepted: true,
      task_id: taskId,
      ...(request.correlation_id && { correlation_id: request.correlation_id }),
    });
  };

  /**
   * GetStatus RPC handler
   *
   * Returns the current status of the queue and worker pool.
   */
  const getStatus: grpc.handleUnaryCall<Empty, StatusResponse> = (
    _call: ServerUnaryCall<Empty, StatusResponse>,
    callback: sendUnaryData<StatusResponse>
  ) => {
    const status = workerPool.getStatus();

    const response: StatusResponse = {
      pending: status.taskCounts.pending,
      processing: status.taskCounts.processing,
      completed: status.taskCounts.completed,
      healthy_workers: status.healthyWorkers,
      total_workers: status.totalWorkers,
      is_running: status.isRunning,
      workers: status.workers.map((w) => ({
        id: w.id,
        browser_options: {
          browser_url: w.browserOptions.browserURL,
        },
        status: workerStatusToProto(w.status),
        processed_count: w.processedCount,
        error_count: w.errorCount,
        error_history: w.errorHistory.map((e) => ({
          type: errorTypeToProto(e.type),
          message: e.message,
          timestamp: e.timestamp,
          ...(e.httpStatusCode !== undefined && {
            http_status_code: e.httpStatusCode,
          }),
          ...(e.httpStatusText !== undefined && {
            http_status_text: e.httpStatusText,
          }),
          ...(e.timeoutMs !== undefined && {
            timeout_ms: e.timeoutMs,
          }),
          ...(e.task && {
            task: {
              task_id: e.task.taskId,
              url: e.task.url,
              labels: e.task.labels,
            },
          }),
        })),
      })),
    };

    callback(null, response);
  };

  return { submitCapture, getStatus };
};
