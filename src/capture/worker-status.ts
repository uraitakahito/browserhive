/**
 * Worker Status
 *
 * XState v5 machine definition for worker status transitions.
 * Uses compound states, context for statistics, and invoked actors
 * for browser connection and the worker processing loop.
 *
 * Proto mappings are handled by grpc/response-mapper.ts via toFlatWorkerStatus().
 */
import { setup, assign, fromPromise, type SnapshotFrom } from "xstate";
import type { Worker } from "./worker.js";
import type { TaskQueue } from "./task-queue.js";
import type { CaptureResult, CaptureTask, ErrorRecord, ErrorDetails } from "./types.js";
import { createConnectionError, createInternalError } from "./error-details.js";
import { workerLoopCallback } from "./worker-loop.js";

const MAX_ERROR_HISTORY = 10;

export interface WorkerMachineContext {
  index: number;
  processedCount: number;
  errorCount: number;
  errorHistory: ErrorRecord[];
  /** Worker instance for browser operations (opaque to the machine) */
  worker: Worker;
  /** Shared task queue reference */
  taskQueue: TaskQueue;
  /** Queue poll interval in ms */
  pollIntervalMs: number;
  /** Max retries for failed tasks */
  maxRetries: number;
}

export interface WorkerMachineInput {
  index: number;
  worker: Worker;
  taskQueue: TaskQueue;
  pollIntervalMs: number;
  maxRetries: number;
}

/** Add an error to the history (FIFO, capped at MAX_ERROR_HISTORY) */
const addErrorToHistory = (
  history: ErrorRecord[],
  errorDetails: ErrorDetails,
  task?: CaptureTask,
): ErrorRecord[] => {
  const record: ErrorRecord = {
    ...errorDetails,
    timestamp: new Date().toISOString(),
    ...(task && {
      task: {
        taskId: task.taskId,
        url: task.url,
        labels: task.labels,
      },
    }),
  };

  const updated = [record, ...history];
  if (updated.length > MAX_ERROR_HISTORY) {
    updated.pop();
  }
  return updated;
};

export const workerStatusMachine = setup({
  types: {
    context: {} as WorkerMachineContext,
    input: {} as WorkerMachineInput,
    events: {} as
      | { type: "CONNECT" }
      | { type: "DISCONNECT" }
      | { type: "TASK_STARTED"; task: CaptureTask }
      | { type: "TASK_DONE"; task: CaptureTask; result: CaptureResult }
      | { type: "TASK_FAILED"; task: CaptureTask; result: CaptureResult }
      | { type: "CONNECTION_LOST"; message: string },
  },
  actors: {
    connectBrowser: fromPromise<undefined, { worker: Worker }>(
      async ({ input }) => {
        await input.worker.connect();
      }
    ),
    disconnectBrowser: fromPromise<undefined, { worker: Worker }>(
      async ({ input }) => {
        await input.worker.disconnect();
      }
    ),
    workerLoop: workerLoopCallback,
  },
  actions: {
    recordTaskSuccess: assign({
      processedCount: ({ context }) => context.processedCount + 1,
    }),
    recordTaskFailure: assign({
      processedCount: ({ context }) => context.processedCount + 1,
      errorCount: ({ context }) => context.errorCount + 1,
      errorHistory: ({ context, event }) => {
        if (event.type !== "TASK_FAILED") return context.errorHistory;
        const errorDetails = event.result.errorDetails ?? createInternalError("Unknown error");
        return addErrorToHistory(context.errorHistory, errorDetails, event.task);
      },
    }),
    recordConnectionError: assign({
      errorCount: ({ context }) => context.errorCount + 1,
      errorHistory: ({ context, event }) => {
        if (event.type !== "CONNECTION_LOST") return context.errorHistory;
        return addErrorToHistory(
          context.errorHistory,
          createConnectionError(event.message),
        );
      },
    }),
  },
}).createMachine({
  id: "workerStatus",
  initial: "stopped",
  context: ({ input }) => ({
    index: input.index,
    processedCount: 0,
    errorCount: 0,
    errorHistory: [],
    worker: input.worker,
    taskQueue: input.taskQueue,
    pollIntervalMs: input.pollIntervalMs,
    maxRetries: input.maxRetries,
  }),
  states: {
    stopped: {
      on: { CONNECT: "connecting" },
    },
    connecting: {
      invoke: {
        src: "connectBrowser",
        input: ({ context }) => ({ worker: context.worker }),
        onDone: "operational",
        onError: {
          target: "error",
          actions: assign({
            errorCount: ({ context }) => context.errorCount + 1,
            errorHistory: ({ context, event }) => {
              const errorMessage = event.error instanceof Error
                ? event.error.message
                : String(event.error);
              return addErrorToHistory(
                context.errorHistory,
                createConnectionError(errorMessage),
              );
            },
          }),
        },
      },
    },
    operational: {
      tags: ["healthy"],
      initial: "idle",
      invoke: {
        src: "workerLoop",
        input: ({ context }) => ({
          worker: context.worker,
          taskQueue: context.taskQueue,
          pollIntervalMs: context.pollIntervalMs,
          maxRetries: context.maxRetries,
        }),
      },
      states: {
        idle: {
          tags: ["canProcess"],
          on: {
            TASK_STARTED: "processing",
          },
        },
        processing: {
          on: {
            TASK_DONE: {
              target: "idle",
              actions: "recordTaskSuccess",
            },
            TASK_FAILED: {
              target: "idle",
              actions: "recordTaskFailure",
            },
          },
        },
      },
      on: {
        CONNECTION_LOST: {
          target: "error",
          actions: "recordConnectionError",
        },
        DISCONNECT: "disconnecting",
      },
    },
    error: {
      on: {
        DISCONNECT: "disconnecting",
      },
    },
    disconnecting: {
      invoke: {
        src: "disconnectBrowser",
        input: ({ context }) => ({ worker: context.worker }),
        onDone: "stopped",
        onError: "stopped",
      },
    },
  },
});

// -- Derived types --

/** Snapshot type for the worker status machine */
export type WorkerMachineSnapshot = SnapshotFrom<typeof workerStatusMachine>;

/**
 * Flat worker status for external consumers (gRPC, reporting).
 * Maps compound machine state values to simple string status.
 */
export type WorkerStatus = "ready" | "busy" | "error" | "stopped";

export const ALL_WORKER_STATUSES: WorkerStatus[] = ["ready", "busy", "error", "stopped"];

/**
 * Convert a worker machine snapshot to a flat WorkerStatus string.
 * The machine uses compound states (e.g., { operational: "idle" }),
 * but external consumers expect flat strings.
 */
export const toFlatWorkerStatus = (snapshot: WorkerMachineSnapshot): WorkerStatus => {
  const value = snapshot.value;

  if (typeof value === "object" && "operational" in value) {
    return value.operational === "processing" ? "busy" : "ready";
  }

  switch (value) {
    case "connecting":
    case "error":
      return "error";
    case "disconnecting":
    case "stopped":
      return "stopped";
    default:
      return "stopped";
  }
};
