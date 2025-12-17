/**
 * Worker Pool
 *
 * Manages a pool of workers that process capture tasks concurrently.
 */
import type { WorkerConfig } from "../config/index.js";
import { TaskQueue, type QueueStatus } from "./task-queue.js";
import { Worker } from "./worker.js";
import type { CaptureTask, WorkerInfo } from "./types.js";
import { isHealthyStatus } from "./worker-status.js";
import { isSuccessStatus } from "./capture-status.js";
import { createChildLogger, logger } from "../logger.js";

export interface PoolStatus {
  queue: QueueStatus;
  healthyWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  workers: WorkerInfo[];
}

export interface EnqueueResult {
  success: boolean;
  error?: string;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: TaskQueue;
  private running = false;
  private workerLoopPromises: Promise<void>[] = [];

  constructor(private config: WorkerConfig) {
    this.taskQueue = new TaskQueue();
  }

  /**
   * Initialize the worker pool by connecting all workers
   */
  async initialize(): Promise<void> {
    const connectionPromises = this.config.browsers.map(
      async (browserOptions, index) => {
        const workerId = `worker-${String(index + 1)}`;
        const worker = new Worker(workerId, browserOptions, this.config.capture);
        const connected = await worker.connect();

        const workerLogger = createChildLogger({ workerId, browserURL: browserOptions.browserURL });
        if (connected) {
          workerLogger.info("Connected to browser");
        } else {
          const latestError = worker.getInfo().errorHistory[0]?.message ?? "Unknown error";
          workerLogger.error(
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

    logger.info(
      { healthyCount, totalCount: this.workers.length },
      "Worker pool initialized"
    );
  }

  /**
   * Start background worker loops
   * Workers will continuously process tasks from the queue
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    const healthyWorkers = this.workers.filter((w) => w.isHealthy);

    if (healthyWorkers.length === 0) {
      throw new Error("No healthy workers available");
    }

    // Start worker loops (non-blocking)
    this.workerLoopPromises = healthyWorkers.map((worker) =>
      this.workerLoop(worker)
    );

    logger.info({ workerCount: healthyWorkers.length }, "Started worker loops");
  }

  enqueueTask(task: CaptureTask): EnqueueResult {
    if (this.config.capture.rejectDuplicateUrls) {
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

    // Wait for worker loops to finish current tasks
    await Promise.all(this.workerLoopPromises);

    const disconnectPromises = this.workers.map((worker) =>
      worker.disconnect()
    );
    await Promise.all(disconnectPromises);
    logger.info("Worker pool shut down");
  }

  get isRunning(): boolean {
    return this.running;
  }

  get healthyWorkerCount(): number {
    return this.workers.filter((w) => w.isHealthy).length;
  }

  getStatus(): PoolStatus {
    return {
      queue: this.taskQueue.getStatus(),
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
    const workerLogger = createChildLogger({ workerId: worker.id });

    while (this.running && worker.isHealthy) {
      const task = this.taskQueue.dequeue();
      if (!task) {
        await this.sleep(this.config.capture.queuePollIntervalMs);
        continue;
      }

      const result = await worker.process(task);
      const workerInfo = worker.getInfo();

      if (!isSuccessStatus(result.status) && this.shouldRetry(task)) {
        workerLogger.info(
          {
            taskLabels: task.labels,
            taskId: task.taskId,
            ...(task.correlationId && { correlationId: task.correlationId }),
            attempt: task.retryCount + 1,
            maxRetries: this.config.capture.maxRetries,
            url: task.url,
          },
          "Retrying task"
        );
        this.taskQueue.requeue(task);
      } else {
        this.taskQueue.markComplete(task.taskId);

        if (isSuccessStatus(result.status)) {
          workerLogger.info(
            {
              taskLabels: task.labels,
              taskId: task.taskId,
              ...(task.correlationId && { correlationId: task.correlationId }),
              url: task.url,
            },
            "Task completed"
          );
        } else {
          workerLogger.warn(
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
        workerLogger.error(
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
    return task.retryCount < this.config.capture.maxRetries;
  }
}
