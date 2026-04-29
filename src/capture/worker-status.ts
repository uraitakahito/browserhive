/**
 * Worker Status
 *
 * XState v5 machine definition for worker status transitions.
 * Uses compound states, context for statistics, and invoked actors
 * for browser connection and the worker processing loop.
 *
 * Proto mappings are handled by grpc/response-mapper.ts via toFlatWorkerStatus().
 *
 * Actor logics used (https://stately.ai/docs/actors#actor-logic-capabilities):
 *
 *   | Actor                                 | Receive events | Send events | Spawn actors | Input | Output |
 *   | ------------------------------------- | -------------- | ----------- | ------------ | ----- | ------ |
 *   | `workerStatusMachine` (State machine) | yes            | yes         | yes          | yes   | yes    |
 *   | `connectBrowser` (Promise)            | no             | yes         | no           | yes   | yes    |
 *   | `disconnectBrowser` (Promise)         | no             | yes         | no           | yes   | yes    |
 *   | `workerLoop` (Callback)               | yes            | yes         | no           | yes   | no     |
 */
import { setup, assign, fromPromise, type SnapshotFrom } from "xstate";
import type { Worker } from "./worker.js";
import type { CaptureResult, CaptureTask, ErrorRecord, ErrorDetails } from "./types.js";
import { createConnectionError, createInternalError } from "./error-details.js";
import { workerLoopCallback, type WorkerLoopConfig } from "./worker-loop.js";

const MAX_ERROR_HISTORY = 10;

export interface WorkerMachineContext {
  index: number;
  processedCount: number;
  errorCount: number;
  errorHistory: ErrorRecord[];
  /** Maximum retry count for failed capture tasks */
  maxRetries: number;
  /** Worker loop config (worker instance, shared queue, polling) */
  loopConfig: WorkerLoopConfig;
}

export interface WorkerMachineInput {
  index: number;
  maxRetries: number;
  loopConfig: WorkerLoopConfig;
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
  guards: {
    canRetry: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return false;
      return event.task.retryCount < context.maxRetries;
    },
  },
  actions: {
    retryTask: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return;
      context.loopConfig.taskQueue.requeue(event.task);
      context.loopConfig.worker.logger.info(
        {
          taskLabels: event.task.labels,
          taskId: event.task.taskId,
          ...(event.task.correlationId && { correlationId: event.task.correlationId }),
          attempt: event.task.retryCount + 1,
          maxRetries: context.maxRetries,
          url: event.task.url,
        },
        "Retrying task",
      );
    },
    markTaskComplete: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return;
      context.loopConfig.taskQueue.markComplete(event.task.taskId);
      context.loopConfig.worker.logger.warn(
        {
          taskLabels: event.task.labels,
          taskId: event.task.taskId,
          ...(event.task.correlationId && { correlationId: event.task.correlationId }),
          error: event.result.errorDetails?.message ?? "Unknown error",
          url: event.task.url,
        },
        "Task failed",
      );
    },
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
  initial: "disconnected",
  context: ({ input }) => ({
    index: input.index,
    processedCount: 0,
    errorCount: 0,
    errorHistory: [],
    maxRetries: input.maxRetries,
    loopConfig: input.loopConfig,
  }),
  states: {
    disconnected: {
      on: { CONNECT: "connecting" },
    },
    connecting: {
      invoke: {
        src: "connectBrowser",
        input: ({ context }) => ({ worker: context.loopConfig.worker }),
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
        input: ({ context }) => context.loopConfig,
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
            TASK_FAILED: [
              {
                guard: "canRetry",
                target: "idle",
                actions: ["retryTask"],
              },
              {
                target: "idle",
                actions: ["markTaskComplete", "recordTaskFailure"],
              },
            ],
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
        input: ({ context }) => ({ worker: context.loopConfig.worker }),
        onDone: "disconnected",
        onError: "disconnected",
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
export type WorkerStatus = "ready" | "busy" | "error" | "disconnected";

export const ALL_WORKER_STATUSES: WorkerStatus[] = ["ready", "busy", "error", "disconnected"];

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
    case "disconnected":
      return "disconnected";
    default:
      return "disconnected";
  }
};
