/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 * Uses the Parent-Child Actor Model: manages a coordinator lifecycle
 * actor and spawns worker status actors for each browser connection.
 */
import { createActor, type ActorRefFrom } from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import { TaskQueue, type TaskCounts } from "./task-queue.js";
import { Worker } from "./worker.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import { coordinatorMachine } from "./coordinator-machine.js";
import {
  workerStatusMachine,
  toFlatWorkerStatus,
  type WorkerMachineContext,
} from "./worker-status.js";
import { logger } from "../logger.js";

/** Timeout for waiting worker actors to stop during shutdown */
const WORKER_SHUTDOWN_TIMEOUT_MS = 5000;

/** Reference to a spawned worker actor with its associated Worker instance */
interface WorkerEntry {
  ref: ActorRefFrom<typeof workerStatusMachine>;
  worker: Worker;
  index: number;
}

export interface CoordinatorStatusReport {
  taskCounts: TaskCounts;
  operationalWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  workers: WorkerInfo[];
}

export interface EnqueueResult {
  success: boolean;
  error?: string;
}

export class CaptureCoordinator {
  private workers: WorkerEntry[] = [];
  private taskQueue: TaskQueue;
  private lifecycleActor = createActor(coordinatorMachine).start();

  private config: CoordinatorConfig;

  constructor(config: CoordinatorConfig) {
    this.config = config;
    this.taskQueue = new TaskQueue();
  }

  /**
   * Initialize the capture coordinator by connecting all workers
   * and spawning their status actors.
   */
  async initialize(): Promise<void> {
    this.lifecycleActor.send({ type: "INITIALIZE" });

    try {
      // Create and connect workers
      const connectionPromises = this.config.browserProfiles.map(
        async (profile, index) => {
          const worker = new Worker(index, profile);
          let connected = false;

          try {
            await worker.connect();
            worker.logger.info("Connected to browser");
            connected = true;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            worker.logger.error({ error: errorMessage }, "Failed to connect to browser");
          }

          return { worker, connected };
        }
      );

      const connectionResults = await Promise.all(connectionPromises);
      const operationalCount = connectionResults.filter((r) => r.connected).length;

      if (operationalCount === 0) {
        this.lifecycleActor.send({ type: "INIT_FAILED" });
        throw new Error("No workers available. All browser connections failed.");
      }

      // Spawn worker status actors for each worker
      this.workers = connectionResults.map(({ worker, connected }) => {
        const ref = createActor(workerStatusMachine, {
          id: `worker-${String(worker.index)}`,
          input: {
            index: worker.index,
            browserProfile: worker.profile,
            worker,
            taskQueue: this.taskQueue,
            pollIntervalMs: this.config.queuePollIntervalMs,
            maxRetries: this.config.maxRetries,
          },
        });
        ref.start();

        if (connected) {
          // Worker is already connected — send CONNECT to enter operational state.
          // The fromPromise connectBrowser will call worker.connect() again,
          // but since browser is already set, it will reconnect.
          // To avoid double-connect, we need a different approach.
          ref.send({ type: "CONNECT" });
        }
        // If not connected, actor stays in "stopped" state

        return { ref, worker, index: worker.index };
      });

      // Subscribe to worker actors for all-error detection
      this.subscribeToWorkerErrors();

      this.lifecycleActor.send({ type: "INIT_DONE" });

      logger.info(
        { operationalCount, totalCount: this.workers.length },
        "Capture coordinator initialized"
      );
    } catch (error) {
      if (this.lifecycleActor.getSnapshot().can({ type: "INIT_FAILED" })) {
        this.lifecycleActor.send({ type: "INIT_FAILED" });
      }
      throw error;
    }
  }

  enqueueTask(task: CaptureTask): EnqueueResult {
    if (this.config.rejectDuplicateUrls) {
      if (this.taskQueue.hasUrl(task.url)) {
        return {
          success: false,
          error: `URL already in queue: ${task.url}`,
        };
      }
    }
    this.taskQueue.enqueue(task);
    return { success: true };
  }

  async shutdown(): Promise<void> {
    if (!this.lifecycleActor.getSnapshot().can({ type: "SHUTDOWN" })) {
      return;
    }

    this.lifecycleActor.send({ type: "SHUTDOWN" });

    // Send DISCONNECT to all worker actors
    for (const entry of this.workers) {
      entry.ref.send({ type: "DISCONNECT" });
    }

    // Wait for all worker actors to reach stopped state, with timeout
    await Promise.race([
      Promise.all(
        this.workers.map(
          (entry) =>
            new Promise<void>((resolve) => {
              // Check if already stopped
              if (entry.ref.getSnapshot().value === "stopped") {
                resolve();
                return;
              }
              const subscription = entry.ref.subscribe((snapshot) => {
                if (snapshot.value === "stopped") {
                  subscription.unsubscribe();
                  resolve();
                }
              });
            })
        )
      ),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          logger.warn(
            { timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
            "Worker shutdown timed out, proceeding to disconnect"
          );
          resolve();
        }, WORKER_SHUTDOWN_TIMEOUT_MS)
      ),
    ]);

    // Force disconnect any workers that didn't stop gracefully
    await Promise.all(
      this.workers.map(async (entry) => {
        await entry.worker.disconnect();
      })
    );

    // Stop all worker actors
    for (const entry of this.workers) {
      entry.ref.stop();
    }

    this.lifecycleActor.send({ type: "SHUTDOWN_DONE" });
    logger.info("Capture coordinator shut down");
  }

  get isRunning(): boolean {
    return this.lifecycleActor.getSnapshot().hasTag("running");
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
      browserProfile: ctx.browserProfile,
      status: toFlatWorkerStatus(snapshot),
      processedCount: ctx.processedCount,
      errorCount: ctx.errorCount,
      errorHistory: [...ctx.errorHistory],
    };
  }

  /**
   * Subscribe to each worker actor and detect when all workers are in error.
   * When all workers become unhealthy, auto-trigger shutdown.
   */
  private subscribeToWorkerErrors(): void {
    for (const entry of this.workers) {
      entry.ref.subscribe(() => {
        if (!this.isRunning) return;

        const allUnhealthy = this.workers.every(
          (w) => !w.ref.getSnapshot().hasTag("healthy")
        );

        if (allUnhealthy && this.workers.length > 0) {
          logger.error("All workers are unhealthy, initiating shutdown");
          this.lifecycleActor.send({ type: "ALL_WORKERS_ERROR" });
        }
      });
    }
  }
}
