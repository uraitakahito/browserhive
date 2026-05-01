/**
 * Coordinator Error Types
 *
 * Structured failure shapes returned (as Result errors) from coordinator
 * lifecycle actors.
 */
import type { ErrorDetails } from "./types.js";

/** A single worker's init failure detail */
export interface WorkerInitFailure {
  browserURL: string;
  reason: ErrorDetails;
}

/**
 * Failure outcome of `shutdownWorkers`. Currently the only failure mode
 * is the disconnect timeout — workers that did not transition to the
 * `disconnected` state within `WORKER_SHUTDOWN_TIMEOUT_MS`. The machine
 * still transitions to `terminated` either way.
 */
export interface ShutdownFailure {
  kind: "timeout";
  timeoutMs: number;
  unsettled: string[];
}
