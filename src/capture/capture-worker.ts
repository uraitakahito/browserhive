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
import { setup, assign, fromPromise, type ActorRefFrom, type SnapshotFrom } from "xstate";
import type { BrowserClient } from "./browser-client.js";
import type { BrowserProfile } from "../config/index.js";
import type { CaptureResult, CaptureTask, ErrorRecord, ErrorDetails, WorkerInfo } from "./types.js";
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
  /**
   * Snapshot of the task currently being processed. Set on TASK_STARTED,
   * cleared on TASK_DONE / TASK_FAILED / CONNECTION_LOST. `startedAt` is a
   * `Date.now()` epoch ms value — converted to ISO at the domain boundary
   * (`toInfo`) so the wire layer can compute `elapsedMs` cheaply.
   */
  currentTask: { task: CaptureTask; startedAt: number } | null;
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
      | { type: "CONNECTION_LOST"; task: CaptureTask; message: string },
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
    // Both `TASK_FAILED` and `CONNECTION_LOST` carry an in-flight task, and
    // both should consume the same retry budget — the failure mode (task-level
    // error vs. connection drop) does not change whether the task itself
    // deserves another attempt.
    canRetry: ({ context, event }) => {
      if (event.type !== "TASK_FAILED" && event.type !== "CONNECTION_LOST") {
        return false;
      }
      return event.task.retryCount < context.maxRetryCount;
    },
  },
  actions: {
    setCurrentTask: assign({
      currentTask: ({ event }) => {
        if (event.type !== "TASK_STARTED") return null;
        return { task: event.task, startedAt: Date.now() };
      },
    }),
    clearCurrentTask: assign({ currentTask: () => null }),
    retryTask: ({ context, event }) => {
      if (event.type !== "TASK_FAILED" && event.type !== "CONNECTION_LOST") return;
      context.runtime.taskQueue.requeue(event.task);
      context.runtime.client.logger.info(
        {
          taskLabels: event.task.labels,
          taskId: event.task.taskId,
          ...(event.task.correlationId && { correlationId: event.task.correlationId }),
          attempt: event.task.retryCount + 1,
          maxRetryCount: context.maxRetryCount,
          url: event.task.url,
          // Disambiguate "the task failed" vs "the connection dropped" in logs;
          // both go through the same retry path now.
          reason: event.type === "CONNECTION_LOST" ? "connection lost" : "task failed",
        },
        "Retrying task",
      );
    },
    markTaskComplete: ({ context, event }) => {
      if (event.type !== "TASK_FAILED" && event.type !== "CONNECTION_LOST") return;
      context.runtime.taskQueue.markComplete(event.task.taskId);
      const errorMessage =
        event.type === "TASK_FAILED"
          ? event.result.errorDetails?.message ?? "Unknown error"
          : event.message;
      context.runtime.client.logger.warn(
        {
          taskLabels: event.task.labels,
          taskId: event.task.taskId,
          ...(event.task.correlationId && { correlationId: event.task.correlationId }),
          error: errorMessage,
          url: event.task.url,
          reason: event.type === "CONNECTION_LOST" ? "connection lost" : "task failed",
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
        // Pass `event.task` so the errorHistory entry surfaces which task was
        // in-flight when the connection dropped — operator-relevant signal
        // visible in /v1/status without correlating logs.
        return addErrorToHistory(
          context.errorHistory,
          createConnectionError(event.message),
          event.task,
        );
      },
    }),
    // Final-processed bump for the no-retry CONNECTION_LOST branch. Kept as a
    // standalone action because `recordConnectionError` (which already
    // increments errorCount + errorHistory) runs on BOTH branches — only the
    // terminal branch should also bump processedCount, so we layer this on
    // top instead of forking recordConnectionError into two variants.
    recordConnectionFinalProcessed: assign({
      processedCount: ({ context }) => context.processedCount + 1,
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
    currentTask: null,
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
            TASK_STARTED: {
              target: "processing",
              actions: "setCurrentTask",
            },
          },
        },
        processing: {
          on: {
            TASK_DONE: {
              target: "idle",
              actions: ["recordTaskSuccess", "clearCurrentTask"],
            },
            TASK_FAILED: [
              {
                guard: "canRetry",
                target: "idle",
                actions: ["retryTask", "clearCurrentTask"],
              },
              {
                target: "idle",
                actions: ["markTaskComplete", "recordTaskFailure", "clearCurrentTask"],
              },
            ],
          },
        },
      },
      on: {
        // 2-branch mirroring TASK_FAILED so the in-flight task is always
        // either requeued (within retry budget) or markComplete'd (budget
        // exhausted) — without this, the task stays pinned in
        // TaskQueue.processing forever after a connection drop. Both
        // branches still target `error` so the worker's overall state
        // reflects the connection loss; the coordinator's degraded retry
        // is what brings it back to operational.
        CONNECTION_LOST: [
          {
            guard: "canRetry",
            target: "error",
            actions: ["retryTask", "recordConnectionError", "clearCurrentTask"],
          },
          {
            target: "error",
            actions: [
              "markTaskComplete",
              "recordConnectionError",
              "recordConnectionFinalProcessed",
              "clearCurrentTask",
            ],
          },
        ],
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

export const isWorkerSettled = (snapshot: CaptureWorkerSnapshot): boolean =>
  snapshot.matches("operational") || snapshot.matches("error");

/**
 * True when the worker has reached the terminal `disconnected` leaf
 * (not `disconnecting`). Used by `shutdownWorkers` to decide when
 * disconnection is complete.
 */
export const isWorkerDisconnected = (snapshot: CaptureWorkerSnapshot): boolean =>
  snapshot.matches("disconnected");

/**
 * CaptureWorker
 *
 * The coordinator and its actors hold `CaptureWorker` instances
 * directly.
 *
 * The class is intentionally a thin wrapper:
 *   - `ref` and `client` are exposed as readonly fields so low-level
 *     XState idioms (`subscribe`, `send`, `getSnapshot`) remain
 *     accessible to consumers that need them.
 *   - Convenience getters / methods (`isHealthy`, `connect`, `toInfo`,
 *     …) express the most common operations in domain terms.
 */
export class CaptureWorker {
  readonly ref: ActorRefFrom<typeof captureWorkerMachine>;
  readonly client: BrowserClient;

  constructor(
    ref: ActorRefFrom<typeof captureWorkerMachine>,
    client: BrowserClient,
  ) {
    this.ref = ref;
    this.client = client;
  }

  // -- identity / config --
  get index(): number {
    return this.client.index;
  }
  get profile(): BrowserProfile {
    return this.client.profile;
  }
  get browserURL(): string {
    return this.client.profile.browserURL;
  }

  // -- state queries --
  getSnapshot(): CaptureWorkerSnapshot {
    return this.ref.getSnapshot();
  }
  get health(): WorkerHealth {
    return toWorkerHealth(this.ref.getSnapshot());
  }
  get isHealthy(): boolean {
    return this.ref.getSnapshot().hasTag("healthy");
  }
  get isSettled(): boolean {
    return isWorkerSettled(this.ref.getSnapshot());
  }
  get isDisconnected(): boolean {
    return isWorkerDisconnected(this.ref.getSnapshot());
  }
  get isInError(): boolean {
    return this.ref.getSnapshot().value === "error";
  }

  // -- actions --
  connect(): void {
    this.ref.send({ type: "CONNECT" });
  }
  disconnect(): void {
    this.ref.send({ type: "DISCONNECT" });
  }

  // -- reporting --
  toInfo(): WorkerInfo {
    const snapshot = this.ref.getSnapshot();
    const current = snapshot.context.currentTask;
    return {
      index: this.client.index,
      browserProfile: this.client.profile,
      health: toWorkerHealth(snapshot),
      processedCount: snapshot.context.processedCount,
      errorCount: snapshot.context.errorCount,
      errorHistory: [...snapshot.context.errorHistory],
      ...(current && {
        currentTask: {
          task: current.task,
          startedAt: new Date(current.startedAt).toISOString(),
        },
      }),
    };
  }

  /**
   * Disconnect the underlying BrowserClient directly, bypassing the
   * actor's `disconnecting` state. Used as a safety net by
   * `shutdownWorkers` after the disconnect timeout, so a stuck actor
   * cannot leave the puppeteer connection open.
   */
  async forceDisconnectClient(): Promise<Result<void, ErrorDetails>> {
    return this.client.disconnect();
  }
}
