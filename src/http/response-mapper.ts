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
  CurrentTaskInfo,
  ErrorRecord,
  WorkerInfo,
} from "../capture/index.js";
import type {
  CoordinatorStatusReport,
  ProcessingTaskView,
} from "../capture/capture-coordinator.js";
import type {
  CaptureAcceptance,
  CurrentTask as CurrentTaskWire,
  ErrorRecord as ErrorRecordWire,
  PendingTask as PendingTaskWire,
  ProcessingTask as ProcessingTaskWire,
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

/**
 * Convert a `CurrentTaskInfo` snapshot to wire shape. `elapsedMs` is
 * computed against the supplied `now` rather than `Date.now()` directly so
 * a single response build sees a consistent clock for every worker.
 */
export const currentTaskToWire = (
  current: CurrentTaskInfo,
  now: number,
): CurrentTaskWire => {
  const elapsedMs = Math.max(0, now - new Date(current.startedAt).getTime());
  return {
    taskId: current.task.taskId,
    url: current.task.url,
    labels: current.task.labels,
    ...(current.task.correlationId !== undefined && {
      correlationId: current.task.correlationId,
    }),
    startedAt: current.startedAt,
    elapsedMs,
    retryCount: current.task.retryCount,
  };
};

export const workerInfoToWire = (
  worker: WorkerInfo,
  now: number = Date.now(),
): WorkerInfoWire => ({
  index: worker.index,
  browserOptions: { browserUrl: worker.browserProfile.browserURL },
  health: worker.health,
  processedCount: worker.processedCount,
  errorCount: worker.errorCount,
  errorHistory: worker.errorHistory.map(errorRecordToWire),
  ...(worker.currentTask && {
    currentTask: currentTaskToWire(worker.currentTask, now),
  }),
});

/**
 * Convert a queued `CaptureTask` to its wire snapshot. `queuedMs` is computed
 * against `now` so a single response build observes a consistent clock.
 */
export const taskToPending = (task: CaptureTask, now: number): PendingTaskWire => {
  const queuedMs = Math.max(0, now - new Date(task.enqueuedAt).getTime());
  return {
    taskId: task.taskId,
    url: task.url,
    labels: task.labels,
    ...(task.correlationId !== undefined && { correlationId: task.correlationId }),
    enqueuedAt: task.enqueuedAt,
    queuedMs,
    retryCount: task.retryCount,
  };
};

/**
 * Convert a `ProcessingTaskView` (worker-aggregated) to wire shape. Computes
 * both `queuedMs` (from task.enqueuedAt) and `elapsedMs` (from view.startedAt)
 * against the same `now` snapshot.
 */
export const taskToProcessing = (
  view: ProcessingTaskView,
  now: number,
): ProcessingTaskWire => {
  const queuedMs = Math.max(0, now - new Date(view.task.enqueuedAt).getTime());
  const elapsedMs = Math.max(0, now - new Date(view.startedAt).getTime());
  return {
    taskId: view.task.taskId,
    url: view.task.url,
    labels: view.task.labels,
    ...(view.task.correlationId !== undefined && {
      correlationId: view.task.correlationId,
    }),
    enqueuedAt: view.task.enqueuedAt,
    queuedMs,
    retryCount: view.task.retryCount,
    workerIndex: view.workerIndex,
    startedAt: view.startedAt,
    elapsedMs,
  };
};

export const coordinatorStatusToResponse = (
  status: CoordinatorStatusReport,
): StatusResponse => {
  // Snapshot the wall clock once per response so every worker's
  // currentTask.elapsedMs and every queue.pendingTasks.queuedMs is computed
  // against the same reference.
  const now = Date.now();
  return {
    pending: status.taskCounts.pending,
    processing: status.taskCounts.processing,
    completed: status.taskCounts.completed,
    operationalWorkers: status.operationalWorkers,
    totalWorkers: status.totalWorkers,
    isRunning: status.isRunning,
    isDegraded: status.isDegraded,
    workers: status.workers.map((w) => workerInfoToWire(w, now)),
    queue: {
      pendingTasks: status.pendingTasks.map((t) => taskToPending(t, now)),
      processingTasks: status.processingTasks.map((p) =>
        taskToProcessing(p, now),
      ),
    },
  };
};
