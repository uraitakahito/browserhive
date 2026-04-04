/**
 * Worker Status Manager
 */
import {
  type WorkerStatus,
  WORKER_STATUS_DEFINITIONS,
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

  canTransitionTo(next: WorkerStatus): boolean {
    return (
      WORKER_STATUS_DEFINITIONS[this._status].allowedTransitions as readonly WorkerStatus[]
    ).includes(next);
  }

  /**
   * Transition to a new state (with validation)
   * @throws Error if the transition is invalid
   */
  transitionTo(next: WorkerStatus): void {
    if (!this.canTransitionTo(next)) {
      throw new Error(
        `Invalid status transition: ${this._status} -> ${next}`
      );
    }
    this._status = next;
  }

  toReady(): void {
    this.transitionTo("ready");
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
