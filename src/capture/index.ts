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
export type { WorkerStatusEvent } from "./worker-status.js";
export {
  ALL_WORKER_STATUSES,
  workerStatusMachine,
} from "./worker-status.js";
export { WorkerStatusManager } from "./worker-status-manager.js";

// Coordinator Lifecycle
export type { CoordinatorLifecycle } from "./coordinator-lifecycle.js";
export type { CoordinatorLifecycleEvent } from "./coordinator-lifecycle.js";
export {
  ALL_COORDINATOR_LIFECYCLES,
  coordinatorLifecycleMachine,
} from "./coordinator-lifecycle.js";
export { CoordinatorLifecycleManager } from "./coordinator-lifecycle-manager.js";

// Classes
export { Worker } from "./worker.js";
export { CaptureCoordinator } from "./capture-coordinator.js";
export type { CoordinatorStatusReport, EnqueueResult } from "./capture-coordinator.js";
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
