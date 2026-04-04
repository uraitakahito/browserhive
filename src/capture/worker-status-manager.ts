/**
 * Worker Status Manager
 */
import {
  type WorkerStatus,
  WORKER_STATUS_DEFINITIONS,
} from "./worker-status.js";
import { StateMachine } from "./state-machine.js";

export class WorkerStatusManager {
  private machine: StateMachine<WorkerStatus>;

  constructor(initialStatus: WorkerStatus = "stopped") {
    this.machine = new StateMachine(WORKER_STATUS_DEFINITIONS, initialStatus);
  }

  get current(): WorkerStatus {
    return this.machine.current;
  }

  get canProcess(): boolean {
    return WORKER_STATUS_DEFINITIONS[this.machine.current].canProcess;
  }

  get isHealthy(): boolean {
    return WORKER_STATUS_DEFINITIONS[this.machine.current].healthy;
  }

  canTransitionTo(next: WorkerStatus): boolean {
    return this.machine.canTransitionTo(next);
  }

  /**
   * Transition to a new state (with validation)
   * @throws Error if the transition is invalid
   */
  transitionTo(next: WorkerStatus): void {
    this.machine.transitionTo(next);
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
