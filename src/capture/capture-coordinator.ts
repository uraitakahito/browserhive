/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 * Uses the Parent-Child Actor Model: drives a coordinator lifecycle
 * actor that spawns and orchestrates worker status actors itself.
 */
import { createActor, type SnapshotFrom } from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import {
  LocalArtifactStore,
  S3ArtifactStore,
  type ArtifactStore,
} from "../storage/index.js";
import { err, ok, type Result } from "../result.js";
import type { TaskQueue, TaskCounts } from "./task-queue.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import { coordinatorMachine } from "./coordinator-machine.js";
import type { CaptureWorker } from "./capture-worker.js";

/** Argument type accepted by `snapshot.matches()` for the coordinator machine. */
type LifecycleMatchesArg = Parameters<SnapshotFrom<typeof coordinatorMachine>["matches"]>[0];

/**
 * View of a task currently held by a worker. Aggregated from
 * `WorkerInfo.currentTask` so the wire layer does not need to traverse
 * `workers` itself.
 */
export interface ProcessingTaskView {
  workerIndex: number;
  task: CaptureTask;
  startedAt: string;
}

export interface CoordinatorStatusReport {
  taskCounts: TaskCounts;
  operationalWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  isDegraded: boolean;
  workers: WorkerInfo[];
  /**
   * Snapshot of the head of the pending queue (size capped by the caller).
   * Tasks are returned without being removed from the queue.
   */
  pendingTasks: CaptureTask[];
  /** All tasks currently being processed (one entry per busy worker). */
  processingTasks: ProcessingTaskView[];
}

/** Default pending-task snapshot size used by `getStatus` when no override is given. */
export const DEFAULT_PENDING_TASKS_LIMIT = 50;

export interface GetStatusOptions {
  /** Maximum number of pending tasks to include. Defaults to {@link DEFAULT_PENDING_TASKS_LIMIT}. */
  pendingLimit?: number;
}

/**
 * Build the `ArtifactStore` instance that backs every capture this
 * coordinator will run. Dispatches on `CoordinatorConfig.storage.kind`.
 */
const buildArtifactStore = (config: CoordinatorConfig): ArtifactStore => {
  const storage = config.storage;
  switch (storage.kind) {
    case "local":
      return new LocalArtifactStore(storage.outputDir);
    case "s3":
      return new S3ArtifactStore(storage);
  }
};

export class CaptureCoordinator {
  private lifecycleActor;
  private store: ArtifactStore;

  constructor(config: CoordinatorConfig) {
    this.store = buildArtifactStore(config);
    this.lifecycleActor = createActor(coordinatorMachine, {
      input: { config, store: this.store },
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
   * Worker spawning and browser connection are driven by the lifecycle
   * machine. Init failures do not abort startup — the coordinator
   * lands in `active.running` (all healthy) or `active.degraded`
   * (some/all failed).
   */
  async initialize(): Promise<void> {
    // fail-fast on storage misconfiguration (e.g. missing S3 bucket /
    // unwritable output directory) BEFORE spawning workers, so the
    // operator sees the cause directly instead of a cascade of capture
    // failures inside `errorHistory`.
    await this.store.initialize();
    this.lifecycleActor.send({ type: "INITIALIZE" });
    await this.waitForLifecycle("active");
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

  getStatus(opts: GetStatusOptions = {}): CoordinatorStatusReport {
    const pendingLimit = opts.pendingLimit ?? DEFAULT_PENDING_TASKS_LIMIT;
    const workerInfos = this.workers.map((worker) => worker.toInfo());
    const processingTasks: ProcessingTaskView[] = workerInfos.flatMap((info) =>
      info.currentTask
        ? [
            {
              workerIndex: info.index,
              task: info.currentTask.task,
              startedAt: info.currentTask.startedAt,
            },
          ]
        : [],
    );
    return {
      taskCounts: this.taskQueue.getStatus(),
      operationalWorkers: this.operationalWorkerCount,
      totalWorkers: this.workers.length,
      isRunning: this.isRunning,
      isDegraded: this.isDegraded,
      workers: workerInfos,
      pendingTasks: this.taskQueue.peekPending(pendingLimit),
      processingTasks,
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
