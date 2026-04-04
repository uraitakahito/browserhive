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
} from "./capture-mode.js";

// Capture Status
export type { CaptureStatus } from "./capture-status.js";
export { captureStatus, isSuccessStatus } from "./capture-status.js";

// Error Type
export type { ErrorType } from "./error-type.js";
export {
  ERROR_TYPE_DEFINITIONS,
  ALL_ERROR_TYPES,
  errorType,
} from "./error-type.js";

// Error Details
export type { ErrorDetails } from "./types.js";
export {
  createHttpError,
  createTimeoutError,
  createConnectionError,
  createInternalError,
  errorDetailsFromException,
} from "./error-details.js";

// Worker Status
export type { WorkerStatus } from "./worker-status.js";
export {
  WORKER_STATUS_DEFINITIONS,
  ALL_WORKER_STATUSES,
  canProcess,
  isHealthyStatus,
} from "./worker-status.js";
export { WorkerStatusManager } from "./worker-status-manager.js";

// Classes
export { Worker } from "./worker.js";
export { CaptureCoordinator } from "./capture-coordinator.js";
export type { CoordinatorStatus, EnqueueResult } from "./capture-coordinator.js";
export { TaskQueue } from "./task-queue.js";
export type { TaskCounts } from "./task-queue.js";
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
