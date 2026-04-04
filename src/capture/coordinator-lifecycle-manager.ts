/**
 * Coordinator Lifecycle Manager
 */
import {
  type CoordinatorLifecycle,
  COORDINATOR_LIFECYCLE_DEFINITIONS,
} from "./coordinator-lifecycle.js";
import { StateMachine } from "./state-machine.js";

export class CoordinatorLifecycleManager {
  private machine: StateMachine<CoordinatorLifecycle>;

  constructor() {
    this.machine = new StateMachine(COORDINATOR_LIFECYCLE_DEFINITIONS, "created");
  }

  get current(): CoordinatorLifecycle {
    return this.machine.current;
  }

  get isRunning(): boolean {
    return this.machine.current === "running";
  }

  canTransitionTo(next: CoordinatorLifecycle): boolean {
    return this.machine.canTransitionTo(next);
  }

  /**
   * Transition to a new state (with validation)
   * @throws Error if the transition is invalid
   */
  transitionTo(next: CoordinatorLifecycle): void {
    this.machine.transitionTo(next);
  }

  toInitializing(): void {
    this.transitionTo("initializing");
  }

  toRunning(): void {
    this.transitionTo("running");
  }

  toShuttingDown(): void {
    this.transitionTo("shuttingDown");
  }

  toStopped(): void {
    this.transitionTo("stopped");
  }
}
