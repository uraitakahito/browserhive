/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 */
import type { WorkerConfig } from "../config/index.js";
import { TaskQueue, type TaskCounts } from "./task-queue.js";
import { Worker } from "./worker.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import { isHealthyStatus } from "./worker-status.js";
import { isSuccessStatus } from "./capture-status.js";
import { logger } from "../logger.js";

/**
 * Timeout for waiting worker loops to finish during shutdown.
 * If a worker is mid-capture (e.g., page load), the loop won't exit
 * until the current task completes. This timeout prevents blocking
 * the entire shutdown chain.
 */
const WORKER_SHUTDOWN_TIMEOUT_MS = 5000;

export interface CoordinatorStatus {
  taskCounts: TaskCounts;
  healthyWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  workers: WorkerInfo[];
}

export interface EnqueueResult {
  success: boolean;
  error?: string;
}

export class CaptureCoordinator {
  private workers: Worker[] = [];
  private taskQueue: TaskQueue;
  private running = false;
  private workerLoopPromises: Promise<void>[] = [];

  constructor(private config: WorkerConfig) {
    this.taskQueue = new TaskQueue();
  }

  /**
   * Initialize the capture coordinator by connecting all workers
   */
  async initialize(): Promise<void> {
    const connectionPromises = this.config.browsers.map(
      async (browserOptions, index) => {
        const workerId = `worker-${String(index + 1)}`;
        const worker = new Worker(workerId, browserOptions, this.config.capture);
        const connected = await worker.connect();

        if (connected) {
          worker.logger.info("Connected to browser");
        } else {
          const latestError = worker.getInfo().errorHistory[0]?.message ?? "Unknown error";
          worker.logger.error(
            { error: latestError },
            "Failed to connect to browser"
          );
        }

        return worker;
      }
    );

    this.workers = await Promise.all(connectionPromises);

    const healthyCount = this.workers.filter((w) => w.isHealthy).length;
    if (healthyCount === 0) {
      throw new Error("No workers available. All browser connections failed.");
    }

    this.running = true;

    const healthyWorkers = this.workers.filter((w) => w.isHealthy);

    // Start worker loops (non-blocking)
    this.workerLoopPromises = healthyWorkers.map((worker) =>
      this.workerLoop(worker)
    );

    logger.info(
      { healthyCount, totalCount: this.workers.length },
      "Capture coordinator initialized"
    );
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
    this.running = false;

    // Wait for worker loops to finish current tasks, with timeout
    await Promise.race([
      Promise.all(this.workerLoopPromises),
      this.sleep(WORKER_SHUTDOWN_TIMEOUT_MS).then(() => {
        logger.warn(
          { timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
          "Worker loop drain timed out, proceeding to disconnect"
        );
      }),
    ]);

    const disconnectPromises = this.workers.map((worker) =>
      worker.disconnect()
    );
    await Promise.all(disconnectPromises);
    logger.info("Capture coordinator shut down");
  }

  get isRunning(): boolean {
    return this.running;
  }

  get healthyWorkerCount(): number {
    return this.workers.filter((w) => w.isHealthy).length;
  }

  getStatus(): CoordinatorStatus {
    return {
      taskCounts: this.taskQueue.getStatus(),
      healthyWorkers: this.workers.filter((w) => w.isHealthy).length,
      totalWorkers: this.workers.length,
      isRunning: this.running,
      workers: this.workers.map((w) => w.getInfo()),
    };
  }

  /**
   * Worker loop - continuously process tasks while running
   */
  private async workerLoop(worker: Worker): Promise<void> {
    while (this.running && worker.isHealthy) {
      const task = this.taskQueue.dequeue();
      if (!task) {
        await this.sleep(this.config.queuePollIntervalMs);
        continue;
      }

      const result = await worker.process(task);
      const workerInfo = worker.getInfo();

      if (!isSuccessStatus(result.status) && this.shouldRetry(task)) {
        worker.logger.info(
          {
            taskLabels: task.labels,
            taskId: task.taskId,
            ...(task.correlationId && { correlationId: task.correlationId }),
            attempt: task.retryCount + 1,
            maxRetries: this.config.maxRetries,
            url: task.url,
          },
          "Retrying task"
        );
        this.taskQueue.requeue(task);
      } else {
        this.taskQueue.markComplete(task.taskId);

        if (isSuccessStatus(result.status)) {
          worker.logger.info(
            {
              taskLabels: task.labels,
              taskId: task.taskId,
              ...(task.correlationId && { correlationId: task.correlationId }),
              url: task.url,
            },
            "Task completed"
          );
        } else {
          worker.logger.warn(
            {
              taskLabels: task.labels,
              taskId: task.taskId,
              ...(task.correlationId && { correlationId: task.correlationId }),
              error: result.errorDetails?.message ?? "Unknown error",
              url: task.url,
            },
            "Task failed"
          );
        }
      }

      // If worker became unhealthy during processing, stop the loop
      if (!isHealthyStatus(workerInfo.status)) {
        worker.logger.error(
          { status: workerInfo.status },
          "Worker became unhealthy, stopping loop"
        );
        break;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldRetry(task: CaptureTask): boolean {
    return task.retryCount < this.config.maxRetries;
  }
}
