/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 * Uses the Parent-Child Actor Model: drives a coordinator lifecycle
 * actor that spawns and orchestrates worker status actors itself.
 */
import { createActor } from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import { err, ok, type Result } from "../result.js";
import type { TaskQueue, TaskCounts } from "./task-queue.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import {
  coordinatorMachine,
  type CoordinatorLifecycle,
  type WorkerEntry,
} from "./coordinator-machine.js";
import type { WorkerInitFailure } from "./coordinator-errors.js";
import {
  toFlatWorkerStatus,
  type WorkerMachineContext,
} from "./worker-status.js";

export interface CoordinatorStatusReport {
  taskCounts: TaskCounts;
  operationalWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  workers: WorkerInfo[];
}

/** Failure outcome of CaptureCoordinator.initialize */
export type CoordinatorInitFailure = WorkerInitFailure;

export class CaptureCoordinator {
  private lifecycleActor;

  constructor(config: CoordinatorConfig) {
    this.lifecycleActor = createActor(coordinatorMachine, {
      input: { config },
    });
    this.lifecycleActor.start();
  }

  private get config(): CoordinatorConfig {
    return this.lifecycleActor.getSnapshot().context.config;
  }

  private get taskQueue(): TaskQueue {
    return this.lifecycleActor.getSnapshot().context.taskQueue;
  }

  private get workers(): WorkerEntry[] {
    return this.lifecycleActor.getSnapshot().context.workers;
  }

  /**
   * Initialize the capture coordinator. Worker spawning, browser connection,
   * and the all-workers-healthy check are all driven by the lifecycle machine
   * (`initializing` state's invoked actor).
   *
   * Returns Result instead of throwing so the rich failure detail captured
   * by `initializeWorkers` reaches the application boundary intact.
   */
  async initialize(): Promise<Result<undefined, CoordinatorInitFailure>> {
    this.lifecycleActor.send({ type: "INITIALIZE" });
    await this.waitForLifecycle("running", "terminated");

    const snapshot = this.lifecycleActor.getSnapshot();
    if (snapshot.value === "terminated") {
      const failure: CoordinatorInitFailure =
        snapshot.context.lastInitFailure ?? {
          kind: "partial-failure",
          operational: 0,
          total: 0,
          failed: [],
        };
      return err(failure);
    }
    return ok(undefined);
  }

  enqueueTask(task: CaptureTask): Result<undefined, string> {
    if (this.config.rejectDuplicateUrls) {
      if (this.taskQueue.hasUrl(task.url)) {
        return err(`URL already in queue: ${task.url}`);
      }
    }
    this.taskQueue.enqueue(task);
    return ok(undefined);
  }

  async shutdown(): Promise<void> {
    if (!this.lifecycleActor.getSnapshot().can({ type: "SHUTDOWN" })) {
      return;
    }
    this.lifecycleActor.send({ type: "SHUTDOWN" });
    await this.waitForLifecycle("terminated");
  }

  get isRunning(): boolean {
    return this.lifecycleActor.getSnapshot().value === "running";
  }

  get operationalWorkerCount(): number {
    return this.workers.filter(
      (entry) => entry.ref.getSnapshot().hasTag("healthy")
    ).length;
  }

  getStatus(): CoordinatorStatusReport {
    return {
      taskCounts: this.taskQueue.getStatus(),
      operationalWorkers: this.operationalWorkerCount,
      totalWorkers: this.workers.length,
      isRunning: this.isRunning,
      workers: this.workers.map((entry) => this.workerEntryToInfo(entry)),
    };
  }

  private workerEntryToInfo(entry: WorkerEntry): WorkerInfo {
    const snapshot = entry.ref.getSnapshot();
    const ctx: WorkerMachineContext = snapshot.context;
    return {
      index: ctx.index,
      browserProfile: ctx.loopConfig.worker.profile,
      status: toFlatWorkerStatus(snapshot),
      processedCount: ctx.processedCount,
      errorCount: ctx.errorCount,
      errorHistory: [...ctx.errorHistory],
    };
  }

  /**
   * Wait for the lifecycle actor to reach one of the given states.
   */
  private async waitForLifecycle(
    ...targets: CoordinatorLifecycle[]
  ): Promise<void> {
    const isTarget = (): boolean => {
      const value = this.lifecycleActor.getSnapshot().value;
      return targets.includes(value);
    };

    await new Promise<void>((resolve) => {
      if (isTarget()) {
        resolve();
        return;
      }
      const subscription = this.lifecycleActor.subscribe(() => {
        if (isTarget()) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });
  }
}
