/**
 * Capture Module (Barrel File)
 */

// Types
export type {
  CaptureTask,
  CaptureResult,
  ErrorTaskInfo,
  ErrorRecord,
  WorkerInfo,
  ValidationResult,
} from "./types.js";

// Capture Options
export type { CaptureOptions } from "./capture-mode.js";
export {
  validateCaptureOptions,
  captureOptionsFromProto,
  captureOptionsToProto,
} from "./capture-mode.js";

// Capture Status
export type { CaptureStatus } from "./capture-status.js";
export {
  CAPTURE_STATUS_DEFINITIONS,
  captureStatus,
  isSuccessStatus,
} from "./capture-status.js";

// Worker Status
export type { WorkerStatus } from "./worker-status.js";
export {
  WORKER_STATUS_DEFINITIONS,
  ALL_WORKER_STATUSES,
  workerStatusToProto,
  canProcess,
  isHealthyStatus,
  canTransitionTo,
} from "./worker-status.js";
export { WorkerStatusManager } from "./worker-status-manager.js";

// Classes
export { Worker } from "./worker.js";
export { WorkerPool } from "./worker-pool.js";
export type { PoolStatus, EnqueueResult } from "./worker-pool.js";
export { TaskQueue } from "./task-queue.js";
export type { QueueStatus } from "./task-queue.js";
export { PageCapturer } from "./page-capturer.js";
export {
  withTimeout,
  validateFilename,
  validateLabels,
  generateFilename,
  hideScrollbars,
  isSuccessHttpStatus,
  INVALID_FILENAME_CHARS_LIST,
  LABELS_SEPARATOR,
} from "./page-capturer.js";
