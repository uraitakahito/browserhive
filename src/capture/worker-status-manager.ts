/**
 * Worker Status Manager
 *
 * Wraps an XState actor for worker status transitions.
 */
import { createActor } from "xstate";
import {
  workerStatusMachine,
  type WorkerStatus,
  type WorkerStatusEvent,
} from "./worker-status.js";

const STATUS_EVENT_MAP: Record<WorkerStatus, WorkerStatusEvent> = {
  ready: { type: "TO_READY" },
  busy: { type: "TO_BUSY" },
  error: { type: "TO_ERROR" },
  stopped: { type: "TO_STOPPED" },
};

export class WorkerStatusManager {
  private actor;

  constructor(initialStatus: WorkerStatus = "stopped") {
    this.actor = createActor(workerStatusMachine, {
      snapshot: workerStatusMachine.resolveState({
        value: initialStatus,
        context: {},
      }),
    });
    this.actor.start();
  }

  get current(): WorkerStatus {
    return this.actor.getSnapshot().value as WorkerStatus;
  }

  get canProcess(): boolean {
    return this.actor.getSnapshot().hasTag("canProcess");
  }

  get isHealthy(): boolean {
    return this.actor.getSnapshot().hasTag("healthy");
  }

  canTransitionTo(next: WorkerStatus): boolean {
    return this.actor.getSnapshot().can(STATUS_EVENT_MAP[next]);
  }

  transitionTo(next: WorkerStatus): void {
    this.actor.send(STATUS_EVENT_MAP[next]);
  }

  toReady(): void {
    this.actor.send({ type: "TO_READY" });
  }

  toBusy(): void {
    this.actor.send({ type: "TO_BUSY" });
  }

  toError(): void {
    this.actor.send({ type: "TO_ERROR" });
  }

  toStopped(): void {
    this.actor.send({ type: "TO_STOPPED" });
  }
}
