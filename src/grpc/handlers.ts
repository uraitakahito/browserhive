/**
 * gRPC Handlers
 *
 * Request handlers for CaptureService RPCs.
 * Uses fire-and-forget pattern: enqueues tasks and returns immediately.
 */
import { status as grpcStatus } from "@grpc/grpc-js";
import type * as grpc from "@grpc/grpc-js";
import type { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import type { CaptureRequest, CaptureAcceptance, Empty, StatusResponse } from "./generated/browserhive/v1/capture.js";
import type { CaptureCoordinator } from "../capture/index.js";
import { createChildLogger } from "../logger.js";
import { captureRequestToTask } from "./request-mapper.js";
import { coordinatorStatusToResponse } from "./response-mapper.js";

/** Create handlers for CaptureService */
export const createCaptureServiceHandlers = (coordinator: CaptureCoordinator) => {
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
    const result = captureRequestToTask(call.request);

    if (!result.ok) {
      callback(null, {
        accepted: false,
        task_id: "",
        error: result.error,
      });
      return;
    }

    // Accept submissions while in any `active.*` substate as long as at
    // least one worker is operational; otherwise the queue would grow
    // with no consumer.
    if (!coordinator.isActive || coordinator.operationalWorkerCount === 0) {
      callback({
        code: grpcStatus.UNAVAILABLE,
        message: "No operational workers available",
      });
      return;
    }

    const task = result.value;

    // Enqueue task (fire-and-forget)
    const enqueueResult = coordinator.enqueueTask(task);

    if (!enqueueResult.ok) {
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
        dismissBanners: task.dismissBanners,
        url: task.url,
      },
      "Capture request accepted"
    );

    // Return immediately with acceptance confirmation
    callback(null, {
      accepted: true,
      task_id: task.taskId,
      ...(task.correlationId && { correlation_id: task.correlationId }),
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
    callback(null, coordinatorStatusToResponse(coordinator.getStatus()));
  };

  return { submitCapture, getStatus };
};
