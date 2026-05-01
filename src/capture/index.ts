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

// Worker Status (XState machine with compound states and context)
export type { WorkerStatus } from "./worker-status.js";
export type { WorkerMachineContext, WorkerMachineInput, WorkerMachineSnapshot } from "./worker-status.js";
export {
  ALL_WORKER_STATUSES,
  workerStatusMachine,
  toFlatWorkerStatus,
} from "./worker-status.js";

// Worker Loop (fromCallback actor for task processing)
export type { WorkerRuntime, WorkerLoopEvent } from "./worker-loop.js";
export { workerLoopCallback } from "./worker-loop.js";

// Coordinator Machine (lifecycle management)
export type { CoordinatorLifecycle } from "./coordinator-machine.js";
export {
  ALL_COORDINATOR_LIFECYCLES,
  coordinatorMachine,
} from "./coordinator-machine.js";

// Coordinator failure types
export type {
  WorkerInitFailure,
  CoordinatorInitFailure,
} from "./coordinator-errors.js";

// Classes
export { Worker } from "./worker.js";
export { CaptureCoordinator } from "./capture-coordinator.js";
export type { CoordinatorStatusReport } from "./capture-coordinator.js";
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
