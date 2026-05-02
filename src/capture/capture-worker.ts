/**
 * Capture Worker
 *
 * XState v5 machine definition for the capture worker actor's lifecycle.
 * Uses compound states, context for statistics, and invoked actors
 * for browser connection and the task processing loop.
 *
 * Error handling: invoked Promise actors (`connectBrowser`,
 * `disconnectBrowser`) return Result<void, ErrorDetails> instead
 * of throwing. The machine branches in `onDone` on `event.output.ok`
 * and never uses `onError`. On the disconnect side, even a failure
 * Result still transitions to `disconnected` (best-effort), but logs
 * the underlying ErrorDetails before doing so.
 *
 * Wire mappings are handled by http/response-mapper.ts via toWorkerHealth().
 *
 * Actor logics used (https://stately.ai/docs/actors#actor-logic-capabilities):
 *
 *   | Actor                                 | Receive events | Send events | Spawn actors | Input | Output |
 *   | ------------------------------------- | -------------- | ----------- | ------------ | ----- | ------ |
 *   | `captureWorkerMachine` (State machine)| yes            | yes         | yes          | yes   | yes    |
 *   | `connectBrowser` (Promise)            | no             | yes         | no           | yes   | yes    |
 *   | `disconnectBrowser` (Promise)         | no             | yes         | no           | yes   | yes    |
 *   | `workerLoop` (Callback)               | yes            | yes         | no           | yes   | no     |
 */
import { setup, assign, fromPromise, type SnapshotFrom } from "xstate";
import type { BrowserClient } from "./browser-client.js";
import type { CaptureResult, CaptureTask, ErrorRecord, ErrorDetails } from "./types.js";
import { createConnectionError, createInternalError } from "./error-details.js";
import { workerLoopCallback, type WorkerRuntime } from "./worker-loop.js";
import type { Result } from "../result.js";

const MAX_ERROR_HISTORY = 10;

/** External seed values supplied when the worker actor is spawned. */
export interface CaptureWorkerInput {
  /** Maximum retry count for failed capture tasks */
  maxRetryCount: number;
  /** Worker runtime (browser client, shared queue, polling) */
  runtime: WorkerRuntime;
}

/** Statistics accumulated by the machine during its lifetime. */
interface CaptureWorkerStats {
  processedCount: number;
  errorCount: number;
  errorHistory: ErrorRecord[];
}

export interface CaptureWorkerContext
  extends CaptureWorkerInput, CaptureWorkerStats {}

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

export const captureWorkerMachine = setup({
  types: {
    context: {} as CaptureWorkerContext,
    input: {} as CaptureWorkerInput,
    events: {} as
      | { type: "CONNECT" }
      | { type: "DISCONNECT" }
      | { type: "TASK_STARTED"; task: CaptureTask }
      | { type: "TASK_DONE"; task: CaptureTask; result: CaptureResult }
      | { type: "TASK_FAILED"; task: CaptureTask; result: CaptureResult }
      | { type: "CONNECTION_LOST"; message: string },
  },
  actors: {
    connectBrowser: fromPromise<Result<void, ErrorDetails>, { client: BrowserClient }>(
      async ({ input }) => input.client.connect(),
    ),
    disconnectBrowser: fromPromise<Result<void, ErrorDetails>, { client: BrowserClient }>(
      async ({ input }) => input.client.disconnect(),
    ),
    workerLoop: workerLoopCallback,
  },
  guards: {
    canRetry: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return false;
      return event.task.retryCount < context.maxRetryCount;
    },
  },
  actions: {
    retryTask: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return;
      context.runtime.taskQueue.requeue(event.task);
      context.runtime.client.logger.info(
        {
          taskLabels: event.task.labels,
          taskId: event.task.taskId,
          ...(event.task.correlationId && { correlationId: event.task.correlationId }),
          attempt: event.task.retryCount + 1,
          maxRetryCount: context.maxRetryCount,
          url: event.task.url,
        },
        "Retrying task",
      );
    },
    markTaskComplete: ({ context, event }) => {
      if (event.type !== "TASK_FAILED") return;
      context.runtime.taskQueue.markComplete(event.task.taskId);
      context.runtime.client.logger.warn(
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
      errorHistory: ({ context, event }): ErrorRecord[] => {
        if (event.type !== "TASK_FAILED") return context.errorHistory;
        const errorDetails = event.result.errorDetails ?? createInternalError("Unknown error");
        return addErrorToHistory(context.errorHistory, errorDetails, event.task);
      },
    }),
    recordConnectionError: assign({
      errorCount: ({ context }) => context.errorCount + 1,
      errorHistory: ({ context, event }): ErrorRecord[] => {
        if (event.type !== "CONNECTION_LOST") return context.errorHistory;
        return addErrorToHistory(
          context.errorHistory,
          createConnectionError(event.message),
        );
      },
    }),
  },
}).createMachine({
  id: "captureWorker",
  initial: "disconnected",
  context: ({ input }): CaptureWorkerContext => ({
    ...input,
    processedCount: 0,
    errorCount: 0,
    errorHistory: [],
  }),
  states: {
    disconnected: {
      on: { CONNECT: "connecting" },
    },
    connecting: {
      invoke: {
        src: "connectBrowser",
        input: ({ context }): { client: BrowserClient } => ({ client: context.runtime.client }),
        onDone: [
          {
            guard: ({ event }) => event.output.ok,
            target: "operational",
          },
          {
            target: "error",
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
              errorHistory: ({ context, event }): ErrorRecord[] =>
                event.output.ok
                  ? context.errorHistory
                  : addErrorToHistory(context.errorHistory, event.output.error),
            }),
          },
        ],
      },
    },
    operational: {
      tags: ["healthy"],
      initial: "idle",
      invoke: {
        src: "workerLoop",
        input: ({ context }) => context.runtime,
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
        // Allow re-attempting the browser connection without first
        // disconnecting. The coordinator's retry actor (in `degraded`)
        // sends CONNECT here directly.
        CONNECT: "connecting",
        DISCONNECT: "disconnecting",
      },
    },
    disconnecting: {
      invoke: {
        src: "disconnectBrowser",
        input: ({ context }): { client: BrowserClient } => ({ client: context.runtime.client }),
        onDone: [
          {
            guard: ({ event }) => event.output.ok,
            target: "disconnected",
          },
          {
            target: "disconnected",
            actions: ({ context, event }) => {
              if (!event.output.ok) {
                context.runtime.client.logger.warn(
                  { reason: event.output.error },
                  "BrowserClient disconnect failed (proceeding to disconnected)",
                );
              }
            },
          },
        ],
      },
    },
  },
});

// -- Derived types --

/** Snapshot type for the capture worker machine */
export type CaptureWorkerSnapshot = SnapshotFrom<typeof captureWorkerMachine>;

/**
 * Flat worker health summary for external consumers (HTTP, reporting).
 * Maps compound machine state values to a simple availability string.
 */
export type WorkerHealth = "ready" | "busy" | "error" | "disconnected";

export const ALL_WORKER_HEALTH_VALUES: WorkerHealth[] = ["ready", "busy", "error", "disconnected"];

/**
 * Convert a capture worker machine snapshot to a flat WorkerHealth string.
 * The machine uses compound states (e.g., { operational: "idle" }),
 * but external consumers expect flat strings.
 */
export const toWorkerHealth = (snapshot: CaptureWorkerSnapshot): WorkerHealth => {
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

/**
 * True when the worker has reached either `operational` or `error` —
 * i.e. a CONNECT attempt has settled with a definite outcome. Used by
 * the coordinator's `initializeWorkers` to decide when waiting is done.
 */
export const isWorkerSettled = (snapshot: CaptureWorkerSnapshot): boolean =>
  snapshot.matches("operational") || snapshot.matches("error");

/**
 * True when the worker has reached the terminal `disconnected` leaf
 * (not `disconnecting`). Used by `shutdownWorkers` to decide when
 * disconnection is complete.
 */
export const isWorkerDisconnected = (snapshot: CaptureWorkerSnapshot): boolean =>
  snapshot.matches("disconnected");
