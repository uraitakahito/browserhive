/**
 * Coordinator Error Types
 *
 * Structured failure shapes returned (as Result errors) from coordinator
 * lifecycle actors. Replaces the previous pattern of throwing Error with
 * embedded format strings, which lost detail across XState's onError edge.
 *
 * Two scopes:
 *   - WorkerInitFailure: a single worker's connect failure detail.
 *   - CoordinatorInitFailure: the orchestration-level verdict, composing
 *     WorkerInitFailure[] in the partial-failure case.
 */
import type { ErrorDetails } from "./types.js";

/** A single worker's init failure detail */
export interface WorkerInitFailure {
  browserURL: string;
  reason: ErrorDetails;
}

/** Failure outcome of `CaptureCoordinator.initialize` / `initializeWorkers` */
export type CoordinatorInitFailure =
  | { kind: "no-profiles" }
  | {
      kind: "partial-failure";
      operational: number;
      total: number;
      failed: WorkerInitFailure[];
    };

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
