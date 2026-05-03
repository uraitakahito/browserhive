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

// Capture Formats
export type { CaptureFormats } from "./capture-formats.js";
export {
  validateCaptureFormats,
} from "./capture-formats.js";

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

// Capture Worker (XState machine with compound states and context)
export type { WorkerHealth } from "./capture-worker.js";
export type { CaptureWorkerContext, CaptureWorkerInput, CaptureWorkerSnapshot } from "./capture-worker.js";
export {
  ALL_WORKER_HEALTH_VALUES,
  captureWorkerMachine,
  CaptureWorker,
  toWorkerHealth,
  isWorkerSettled,
  isWorkerDisconnected,
} from "./capture-worker.js";

// Worker Loop (fromCallback actor for task processing)
export type { WorkerRuntime, WorkerLoopEvent } from "./worker-loop.js";
export { workerLoopCallback } from "./worker-loop.js";

// Coordinator Machine (lifecycle management)
export type { CoordinatorLifecycle } from "./coordinator-machine.js";
export {
  ALL_COORDINATOR_LIFECYCLES,
  coordinatorMachine,
} from "./coordinator-machine.js";

// Banner / modal dismissal
export type {
  CmpEntry,
  DismissOptions,
  DismissReport,
  HeuristicThresholds,
} from "./banner-dismisser.js";
export {
  DEFAULT_DISMISS_OPTIONS,
  DEFAULT_HEURISTIC_THRESHOLDS,
  EMPTY_DISMISS_REPORT,
  KNOWN_CMP_ENTRIES,
  dismissBanners,
  runDismissalInDocument,
} from "./banner-dismisser.js";

// Classes
export { BrowserClient } from "./browser-client.js";
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
