/**
 * Response Mapper (Outbound)
 *
 * Converts domain types to OpenAPI schema types for HTTP responses.
 * The OpenAPI schemas use camelCase consistently, matching the domain
 * types, so most fields pass through verbatim — the mapper exists to
 * keep the boundary between domain and wire types explicit and to
 * satisfy `exactOptionalPropertyTypes`.
 */
import type {
  CaptureTask,
  ErrorRecord,
  WorkerInfo,
} from "../capture/index.js";
import type { CoordinatorStatusReport } from "../capture/capture-coordinator.js";
import type {
  CaptureAcceptance,
  ErrorRecord as ErrorRecordWire,
  StatusResponse,
  WorkerInfo as WorkerInfoWire,
} from "./generated/index.js";

export const taskToAcceptance = (task: CaptureTask): CaptureAcceptance => ({
  accepted: true,
  taskId: task.taskId,
  ...(task.correlationId !== undefined && { correlationId: task.correlationId }),
});

export const errorRecordToWire = (record: ErrorRecord): ErrorRecordWire => ({
  type: record.type,
  message: record.message,
  timestamp: record.timestamp,
  ...(record.httpStatusCode !== undefined && {
    httpStatusCode: record.httpStatusCode,
  }),
  ...(record.httpStatusText !== undefined && {
    httpStatusText: record.httpStatusText,
  }),
  ...(record.timeoutMs !== undefined && { timeoutMs: record.timeoutMs }),
  ...(record.task && {
    task: {
      taskId: record.task.taskId,
      url: record.task.url,
      labels: record.task.labels,
    },
  }),
});

export const workerInfoToWire = (worker: WorkerInfo): WorkerInfoWire => ({
  index: worker.index,
  browserOptions: { browserUrl: worker.browserProfile.browserURL },
  health: worker.health,
  processedCount: worker.processedCount,
  errorCount: worker.errorCount,
  errorHistory: worker.errorHistory.map(errorRecordToWire),
});

export const coordinatorStatusToResponse = (
  status: CoordinatorStatusReport,
): StatusResponse => ({
  pending: status.taskCounts.pending,
  processing: status.taskCounts.processing,
  completed: status.taskCounts.completed,
  operationalWorkers: status.operationalWorkers,
  totalWorkers: status.totalWorkers,
  isRunning: status.isRunning,
  isDegraded: status.isDegraded,
  workers: status.workers.map(workerInfoToWire),
});
