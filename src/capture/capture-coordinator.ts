/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 * Uses the Parent-Child Actor Model: drives a coordinator lifecycle
 * actor that spawns and orchestrates worker status actors itself.
 */
import { createActor, type SnapshotFrom } from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import { err, ok, type Result } from "../result.js";
import type { TaskQueue, TaskCounts } from "./task-queue.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import { coordinatorMachine } from "./coordinator-machine.js";
import type { WorkerInitFailure } from "./coordinator-errors.js";
import type { CaptureWorker } from "./capture-worker.js";

/** Argument type accepted by `snapshot.matches()` for the coordinator machine. */
type LifecycleMatchesArg = Parameters<SnapshotFrom<typeof coordinatorMachine>["matches"]>[0];

export interface CoordinatorStatusReport {
  taskCounts: TaskCounts;
  operationalWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  isDegraded: boolean;
  workers: WorkerInfo[];
}

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

  private get workers(): CaptureWorker[] {
    return this.lifecycleActor.getSnapshot().context.workers;
  }

  /**
   * Initialize the capture coordinator. Worker spawning and browser
   * connection are driven by the lifecycle machine. Init failures do
   * not abort startup — the coordinator lands in `active.running` (all
   * healthy) or `active.degraded` (some/all failed). Inspect
   * `lastInitFailedWorkers` for detail.
   */
  async initialize(): Promise<void> {
    this.lifecycleActor.send({ type: "INITIALIZE" });
    await this.waitForLifecycle("active");
  }

  /**
   * Workers that did not reach operational during the last `initialize()`.
   * Empty when all workers connected successfully.
   */
  get lastInitFailedWorkers(): WorkerInitFailure[] {
    return this.lifecycleActor.getSnapshot().context.lastInitSummary?.failed ?? [];
  }

  enqueueTask(task: CaptureTask): Result<void, string> {
    if (this.config.rejectDuplicateUrls) {
      if (this.taskQueue.hasUrl(task.url)) {
        return err(`URL already in queue: ${task.url}`);
      }
    }
    this.taskQueue.enqueue(task);
    return ok();
  }

  async shutdown(): Promise<void> {
    if (!this.lifecycleActor.getSnapshot().can({ type: "SHUTDOWN" })) {
      return;
    }
    this.lifecycleActor.send({ type: "SHUTDOWN" });
    await this.waitForLifecycle("terminated");
  }

  /** True when the lifecycle is in `active.running` (all workers healthy). */
  get isRunning(): boolean {
    return this.lifecycleActor.getSnapshot().matches({ active: "running" });
  }

  /** True when the lifecycle is in `active.degraded` (some workers unhealthy, retry loop running). */
  get isDegraded(): boolean {
    return this.lifecycleActor.getSnapshot().matches({ active: "degraded" });
  }

  /**
   * True when the lifecycle is in any `active.*` substate. Equivalent to
   * `isRunning || isDegraded`. Use this to decide whether the coordinator
   * is accepting traffic.
   */
  get isActive(): boolean {
    return this.lifecycleActor.getSnapshot().matches("active");
  }

  get operationalWorkerCount(): number {
    return this.workers.filter((worker) => worker.isHealthy).length;
  }

  getStatus(): CoordinatorStatusReport {
    return {
      taskCounts: this.taskQueue.getStatus(),
      operationalWorkers: this.operationalWorkerCount,
      totalWorkers: this.workers.length,
      isRunning: this.isRunning,
      isDegraded: this.isDegraded,
      workers: this.workers.map((worker) => worker.toInfo()),
    };
  }

  /**
   * Wait for the lifecycle actor to match one of the given state paths.
   * Each target is passed to `snapshot.matches()`, so compound paths
   * (e.g. `"active"` to cover both substates, or `"active.running"` for
   * one substate) work directly.
   */
  private async waitForLifecycle(
    ...targets: LifecycleMatchesArg[]
  ): Promise<void> {
    const isTarget = (): boolean => {
      const snapshot = this.lifecycleActor.getSnapshot();
      return targets.some((t) => snapshot.matches(t));
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
