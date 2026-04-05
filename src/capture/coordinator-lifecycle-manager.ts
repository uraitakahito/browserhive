/**
 * Coordinator Lifecycle Manager
 *
 * Wraps an XState actor for coordinator lifecycle transitions.
 */
import { createActor, type ActorRefFrom } from "xstate";
import {
  coordinatorLifecycleMachine,
  type CoordinatorLifecycle,
  type CoordinatorLifecycleEvent,
} from "./coordinator-lifecycle.js";

const LIFECYCLE_EVENT_MAP: Record<CoordinatorLifecycle, CoordinatorLifecycleEvent> = {
  created: { type: "CREATE" },
  initializing: { type: "INITIALIZE" },
  running: { type: "RUN" },
  shuttingDown: { type: "SHUT_DOWN" },
  stopped: { type: "STOP" },
};

export class CoordinatorLifecycleManager {
  private actor: ActorRefFrom<typeof coordinatorLifecycleMachine>;

  constructor() {
    this.actor = createActor(coordinatorLifecycleMachine);
    this.actor.start();
  }

  get current(): CoordinatorLifecycle {
    return this.actor.getSnapshot().value;
  }

  get isRunning(): boolean {
    return this.actor.getSnapshot().hasTag("running");
  }

  canTransitionTo(next: CoordinatorLifecycle): boolean {
    return this.actor.getSnapshot().can(LIFECYCLE_EVENT_MAP[next]);
  }

  transitionTo(next: CoordinatorLifecycle): void {
    this.actor.send(LIFECYCLE_EVENT_MAP[next]);
  }

  toInitializing(): void {
    this.actor.send({ type: "INITIALIZE" });
  }

  toRunning(): void {
    this.actor.send({ type: "RUN" });
  }

  toShuttingDown(): void {
    this.actor.send({ type: "SHUT_DOWN" });
  }

  toStopped(): void {
    this.actor.send({ type: "STOP" });
  }
}
