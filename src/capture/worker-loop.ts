/**
 * Worker Loop
 *
 * fromCallback actor logic for the worker processing loop.
 * Invoked by the worker status machine when in operational state.
 * Polls the task queue, processes tasks via the BrowserClient instance,
 * and sends events back to the parent machine.
 */
import { fromCallback } from "xstate";
import type { BrowserClient } from "./browser-client.js";
import type { TaskQueue } from "./task-queue.js";
import type { CaptureTask, CaptureResult } from "./types.js";
import { isSuccessStatus } from "./capture-status.js";
import { errorDetailsFromException } from "./error-details.js";

export interface WorkerRuntime {
  client: BrowserClient;
  taskQueue: TaskQueue;
  pollIntervalMs: number;
}

export type WorkerLoopEvent =
  | { type: "TASK_STARTED"; task: CaptureTask }
  | { type: "TASK_DONE"; task: CaptureTask; result: CaptureResult }
  | { type: "TASK_FAILED"; task: CaptureTask; result: CaptureResult }
  // `task` is the in-flight task at the moment of disconnection. `CONNECTION_LOST`
  // is only sent from inside the catch block below, where a task has already
  // been dequeued and `process()` was attempted on it — the field is therefore
  // always populated. The state machine uses it to apply the same retry-budget
  // policy as `TASK_FAILED` (requeue or markComplete) instead of leaking the
  // task into TaskQueue.processing forever.
  | { type: "CONNECTION_LOST"; task: CaptureTask; message: string };

export interface WorkerLoopParentEvent { type: "STOP_LOOP" }

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Callback actor (fromCallback) — receive: yes, send: yes, spawn: no, input: yes, output: no
export const workerLoopCallback = fromCallback<WorkerLoopParentEvent, WorkerRuntime>(
  ({ sendBack, receive, input }) => {
    let running = true;

    // Destructuring copies the reference, not the object itself.
    // All worker loops share the single TaskQueue instance created
    // by CaptureCoordinator, so no duplicate task processing occurs.
    const { client, taskQueue, pollIntervalMs } = input;

    const loop = async (): Promise<void> => {
      while (running) {
        const task = taskQueue.dequeue();
        if (!task) {
          await sleep(pollIntervalMs);
          continue;
        }

        sendBack({ type: "TASK_STARTED", task });

        try {
          const result = await client.process(task);

          if (isSuccessStatus(result.status)) {
            taskQueue.markComplete(task.taskId);
            client.logger.info(
              {
                taskLabels: task.labels,
                taskId: task.taskId,
                ...(task.correlationId && { correlationId: task.correlationId }),
                url: task.url,
                ...(result.linksLocation && { linksLocation: result.linksLocation }),
                ...(result.pdfLocation && { pdfLocation: result.pdfLocation }),
                ...(result.mhtmlLocation && { mhtmlLocation: result.mhtmlLocation }),
                ...(result.waczLocation && { waczLocation: result.waczLocation }),
                ...(result.waczStats && { waczStats: result.waczStats }),
                ...(result.dismissReport && { dismissReport: result.dismissReport }),
              },
              "Task completed"
            );
            sendBack({ type: "TASK_DONE", task, result });
          } else {
            // Report failure to parent machine, which decides retry vs final failure
            sendBack({ type: "TASK_FAILED", task, result });
          }
        } catch (error) {
          const errorDetails = errorDetailsFromException(error);

          if (errorDetails.type === "connection") {
            // `task` was dequeued earlier in this loop iteration; passing it
            // here lets the state machine apply the same retry/markComplete
            // policy as TASK_FAILED instead of leaving the task pinned in
            // TaskQueue.processing.
            sendBack({ type: "CONNECTION_LOST", task, message: errorDetails.message });
            break;
          }

          // Non-connection errors: report failure to parent machine
          sendBack({
            type: "TASK_FAILED",
            task,
            result: {
              task,
              status: "failed",
              errorDetails,
              captureProcessingTimeMs: 0,
              timestamp: new Date().toISOString(),
              workerIndex: client.index,
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
