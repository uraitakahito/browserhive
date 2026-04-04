/**
 * Response Mapper (Outbound)
 *
 * Converts domain types to Proto types for gRPC responses.
 */
import {
  WorkerStatus as ProtoWorkerStatus,
  ErrorType as ProtoErrorType,
  type CaptureOptions as ProtoCaptureOptions,
  type ErrorRecord as ProtoErrorRecord,
  type WorkerInfo as ProtoWorkerInfo,
  type StatusResponse,
} from "./generated/browserhive/v1/capture.js";
import type {
  WorkerStatus,
  ErrorType,
  CaptureOptions,
  ErrorRecord,
  WorkerInfo,
} from "../capture/index.js";
import type { CoordinatorStatus } from "../capture/capture-coordinator.js";

const WORKER_STATUS_PROTO_MAP: Record<WorkerStatus, ProtoWorkerStatus> = {
  idle: ProtoWorkerStatus.WORKER_STATUS_IDLE,
  busy: ProtoWorkerStatus.WORKER_STATUS_BUSY,
  error: ProtoWorkerStatus.WORKER_STATUS_ERROR,
  stopped: ProtoWorkerStatus.WORKER_STATUS_STOPPED,
};

const ERROR_TYPE_PROTO_MAP: Record<ErrorType, ProtoErrorType> = {
  http: ProtoErrorType.ERROR_TYPE_HTTP,
  timeout: ProtoErrorType.ERROR_TYPE_TIMEOUT,
  connection: ProtoErrorType.ERROR_TYPE_CONNECTION,
  internal: ProtoErrorType.ERROR_TYPE_INTERNAL,
};

export const workerStatusToProto = (status: WorkerStatus): ProtoWorkerStatus => {
  return WORKER_STATUS_PROTO_MAP[status];
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
    status: workerStatusToProto(worker.status),
    processed_count: worker.processedCount,
    error_count: worker.errorCount,
    error_history: worker.errorHistory.map(errorRecordToProto),
  };
};

export const coordinatorStatusToResponse = (status: CoordinatorStatus): StatusResponse => {
  return {
    pending: status.taskCounts.pending,
    processing: status.taskCounts.processing,
    completed: status.taskCounts.completed,
    operational_workers: status.operationalWorkers,
    total_workers: status.totalWorkers,
    is_running: status.isRunning,
    workers: status.workers.map(workerInfoToProto),
  };
};
