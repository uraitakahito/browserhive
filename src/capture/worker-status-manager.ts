/**
 * Worker Status Manager
 */
import {
  type WorkerStatus,
  WORKER_STATUS_DEFINITIONS,
  canTransitionTo,
} from "./worker-status.js";

export class WorkerStatusManager {
  private _status: WorkerStatus;

  constructor(initialStatus: WorkerStatus = "stopped") {
    this._status = initialStatus;
  }

  get current(): WorkerStatus {
    return this._status;
  }

  get canProcess(): boolean {
    return WORKER_STATUS_DEFINITIONS[this._status].canProcess;
  }

  get isHealthy(): boolean {
    return WORKER_STATUS_DEFINITIONS[this._status].healthy;
  }

  /**
   * Transition to a new state (with validation)
   * @throws Error if the transition is invalid
   */
  transitionTo(next: WorkerStatus): void {
    if (this._status === next) {
      return; // Allow transition to the same state (idempotency)
    }
    if (!canTransitionTo(this._status, next)) {
      throw new Error(
        `Invalid status transition: ${this._status} -> ${next}`
      );
    }
    this._status = next;
  }

  toIdle(): void {
    this.transitionTo("idle");
  }

  toBusy(): void {
    this.transitionTo("busy");
  }

  toError(): void {
    this.transitionTo("error");
  }

  toStopped(): void {
    this.transitionTo("stopped");
  }
}
