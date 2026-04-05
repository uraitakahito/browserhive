/**
 * Worker Loop
 *
 * fromCallback actor logic for the worker processing loop.
 * Invoked by the worker status machine when in operational state.
 * Polls the task queue, processes tasks via the Worker instance,
 * and sends events back to the parent machine.
 */
import { fromCallback } from "xstate";
import type { Worker } from "./worker.js";
import type { TaskQueue } from "./task-queue.js";
import type { CaptureTask, CaptureResult } from "./types.js";
import { isSuccessStatus } from "./capture-status.js";
import { errorDetailsFromException } from "./error-details.js";

export interface WorkerLoopInput {
  worker: Worker;
  taskQueue: TaskQueue;
  pollIntervalMs: number;
  maxRetries: number;
}

export type WorkerLoopEvent =
  | { type: "TASK_STARTED"; task: CaptureTask }
  | { type: "TASK_DONE"; task: CaptureTask; result: CaptureResult }
  | { type: "TASK_FAILED"; task: CaptureTask; result: CaptureResult }
  | { type: "CONNECTION_LOST"; message: string };

export interface WorkerLoopParentEvent { type: "STOP_LOOP" }

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const workerLoopCallback = fromCallback<WorkerLoopParentEvent, WorkerLoopInput>(
  ({ sendBack, receive, input }) => {
    let running = true;

    // Destructuring copies the reference, not the object itself.
    // All worker loops share the single TaskQueue instance created
    // by CaptureCoordinator, so no duplicate task processing occurs.
    const { worker, taskQueue, pollIntervalMs, maxRetries } = input;

    const loop = async (): Promise<void> => {
      while (running) {
        const task = taskQueue.dequeue();
        if (!task) {
          await sleep(pollIntervalMs);
          continue;
        }

        sendBack({ type: "TASK_STARTED", task });

        try {
          const result = await worker.process(task);

          if (isSuccessStatus(result.status)) {
            taskQueue.markComplete(task.taskId);
            worker.logger.info(
              {
                taskLabels: task.labels,
                taskId: task.taskId,
                ...(task.correlationId && { correlationId: task.correlationId }),
                url: task.url,
              },
              "Task completed"
            );
            sendBack({ type: "TASK_DONE", task, result });
          } else if (task.retryCount < maxRetries) {
            taskQueue.requeue(task);
            worker.logger.info(
              {
                taskLabels: task.labels,
                taskId: task.taskId,
                ...(task.correlationId && { correlationId: task.correlationId }),
                attempt: task.retryCount + 1,
                maxRetries,
                url: task.url,
              },
              "Retrying task"
            );
            // Retry does not count as done or failed — the task goes back to queue
            sendBack({ type: "TASK_FAILED", task, result });
          } else {
            taskQueue.markComplete(task.taskId);
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
            sendBack({ type: "TASK_FAILED", task, result });
          }
        } catch (error) {
          const errorDetails = errorDetailsFromException(error);

          if (errorDetails.type === "connection") {
            sendBack({ type: "CONNECTION_LOST", message: errorDetails.message });
            break;
          }

          // Non-connection errors: mark complete, report failure, continue loop
          taskQueue.markComplete(task.taskId);
          worker.logger.warn(
            {
              taskLabels: task.labels,
              taskId: task.taskId,
              ...(task.correlationId && { correlationId: task.correlationId }),
              error: errorDetails.message,
              url: task.url,
            },
            "Task failed with exception"
          );
          sendBack({
            type: "TASK_FAILED",
            task,
            result: {
              task,
              status: "failed",
              errorDetails,
              captureProcessingTimeMs: 0,
              timestamp: new Date().toISOString(),
              workerIndex: worker.index,
            },
          });
        }
      }
    };

    // Start the loop (fire-and-forget, errors are handled inside)
    void loop();

    // Listen for stop signal from parent
    receive(() => {
      running = false;
    });

    // Cleanup: stop the loop when the invoked callback is disposed
    return () => {
      running = false;
    };
  }
);
