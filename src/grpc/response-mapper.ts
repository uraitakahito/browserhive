/**
 * Response Mapper (Outbound)
 *
 * Converts domain types to Proto types for gRPC responses.
 */
import {
  WorkerHealth as ProtoWorkerHealth,
  ErrorType as ProtoErrorType,
  type CaptureOptions as ProtoCaptureOptions,
  type ErrorRecord as ProtoErrorRecord,
  type WorkerInfo as ProtoWorkerInfo,
  type StatusResponse,
} from "./generated/browserhive/v1/capture.js";
import type {
  WorkerHealth,
  ErrorType,
  CaptureOptions,
  ErrorRecord,
  WorkerInfo,
} from "../capture/index.js";
import type { CoordinatorStatusReport } from "../capture/capture-coordinator.js";

const WORKER_HEALTH_PROTO_MAP: Record<WorkerHealth, ProtoWorkerHealth> = {
  ready: ProtoWorkerHealth.WORKER_HEALTH_READY,
  busy: ProtoWorkerHealth.WORKER_HEALTH_BUSY,
  error: ProtoWorkerHealth.WORKER_HEALTH_ERROR,
  disconnected: ProtoWorkerHealth.WORKER_HEALTH_DISCONNECTED,
};

const ERROR_TYPE_PROTO_MAP: Record<ErrorType, ProtoErrorType> = {
  http: ProtoErrorType.ERROR_TYPE_HTTP,
  timeout: ProtoErrorType.ERROR_TYPE_TIMEOUT,
  connection: ProtoErrorType.ERROR_TYPE_CONNECTION,
  internal: ProtoErrorType.ERROR_TYPE_INTERNAL,
};

export const workerHealthToProto = (health: WorkerHealth): ProtoWorkerHealth => {
  return WORKER_HEALTH_PROTO_MAP[health];
};

export const errorTypeToProto = (type: ErrorType): ProtoErrorType => {
  return ERROR_TYPE_PROTO_MAP[type];
};

export const captureOptionsToProto = (options: CaptureOptions): ProtoCaptureOptions => {
  return {
    png: options.png,
    jpeg: options.jpeg,
    html: options.html,
  };
};

export const errorRecordToProto = (record: ErrorRecord): ProtoErrorRecord => {
  return {
    type: errorTypeToProto(record.type),
    message: record.message,
    timestamp: record.timestamp,
    ...(record.httpStatusCode !== undefined && {
      http_status_code: record.httpStatusCode,
    }),
    ...(record.httpStatusText !== undefined && {
      http_status_text: record.httpStatusText,
    }),
    ...(record.timeoutMs !== undefined && {
      timeout_ms: record.timeoutMs,
    }),
    ...(record.task && {
      task: {
        task_id: record.task.taskId,
        url: record.task.url,
        labels: record.task.labels,
      },
    }),
  };
};

export const workerInfoToProto = (worker: WorkerInfo): ProtoWorkerInfo => {
  return {
    index: worker.index,
    browser_options: {
      browser_url: worker.browserProfile.browserURL,
    },
    health: workerHealthToProto(worker.health),
    processed_count: worker.processedCount,
    error_count: worker.errorCount,
    error_history: worker.errorHistory.map(errorRecordToProto),
  };
};

export const coordinatorStatusToResponse = (status: CoordinatorStatusReport): StatusResponse => {
  return {
    pending: status.taskCounts.pending,
    processing: status.taskCounts.processing,
    completed: status.taskCounts.completed,
    operational_workers: status.operationalWorkers,
    total_workers: status.totalWorkers,
    is_running: status.isRunning,
    is_degraded: status.isDegraded,
    workers: status.workers.map(workerInfoToProto),
  };
};
