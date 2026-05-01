/**
 * Coordinator Machine
 *
 * XState v5 machine definition for the capture coordinator lifecycle.
 * The machine spawns and orchestrates worker status actors via invoked
 * actors (Parent-Child Actor Model). Actor implementations live in
 * coordinator-actors.ts.
 *
 * Error handling: invoked Promise actors (`initializeWorkers`,
 * `shutdownWorkers`) return Result<T, E> instead of throwing. The
 * machine branches in `onDone` on `event.output.ok` to drive the next
 * state, and persists the failure value on `context.lastInitFailure`
 * so that `CaptureCoordinator.initialize` can surface the rich detail
 * to the application boundary.
 *
 * Actor logics used (https://stately.ai/docs/actors#actor-logic-capabilities):
 *
 *   | Actor                                | Receive events | Send events | Spawn actors | Input | Output |
 *   | ------------------------------------ | -------------- | ----------- | ------------ | ----- | ------ |
 *   | `coordinatorMachine` (State machine) | yes            | yes         | yes          | yes   | yes    |
 *   | `workerStatus` (State machine)       | yes            | yes         | yes          | yes   | yes    |
 *   | `initializeWorkers` (Promise)        | no             | yes         | no           | yes   | yes    |
 *   | `watchWorkerHealth` (Callback)       | no             | yes         | no           | yes   | no     |
 *   | `shutdownWorkers` (Promise)          | no             | yes         | no           | yes   | yes    |
 */
import {
  assign,
  setup,
  type ActorRefFrom,
  type StateValueFrom,
} from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import { logger } from "../logger.js";
import {
  initializeWorkers,
  shutdownWorkers,
  watchWorkerHealth,
} from "./coordinator-actors.js";
import type { CoordinatorInitFailure } from "./coordinator-errors.js";
import { TaskQueue } from "./task-queue.js";
import { Worker } from "./worker.js";
import { workerStatusMachine } from "./worker-status.js";

/** Reference to a spawned worker actor with its associated Worker instance */
export interface WorkerEntry {
  ref: ActorRefFrom<typeof workerStatusMachine>;
  worker: Worker;
  index: number;
}

export interface CoordinatorMachineContext {
  config: CoordinatorConfig;
  taskQueue: TaskQueue;
  workers: WorkerEntry[];
  /** Detail captured when initializeWorkers returns a failure Result */
  lastInitFailure?: CoordinatorInitFailure;
}

export interface CoordinatorMachineInput {
  config: CoordinatorConfig;
}

export const coordinatorMachine = setup({
  types: {
    context: {} as CoordinatorMachineContext,
    input: {} as CoordinatorMachineInput,
    events: {} as
      | { type: "INITIALIZE" }
      | { type: "SHUTDOWN" }
      | { type: "ALL_WORKERS_ERROR" },
  },
  actors: {
    workerStatus: workerStatusMachine,
    initializeWorkers,
    watchWorkerHealth,
    shutdownWorkers,
  },
}).createMachine({
  id: "coordinatorLifecycle",
  initial: "created",
  context: ({ input }) => ({
    config: input.config,
    taskQueue: new TaskQueue(),
    workers: [],
  }),
  states: {
    created: {
      on: { INITIALIZE: "initializing" },
    },
    initializing: {
      entry: assign({
        workers: ({ context, spawn }) =>
          context.config.browserProfiles.map((profile, index) => {
            const worker = new Worker(index, profile);
            const ref = spawn("workerStatus", {
              id: `worker-${String(index)}`,
              input: {
                index,
                maxRetries: context.config.maxRetries,
                loopConfig: {
                  worker,
                  taskQueue: context.taskQueue,
                  pollIntervalMs: context.config.queuePollIntervalMs,
                },
              },
            });
            return { ref, worker, index };
          }),
      }),
      invoke: {
        src: "initializeWorkers",
        input: ({ context }) => ({ workers: context.workers }),
        onDone: [
          {
            guard: ({ event }) => event.output.ok,
            target: "running",
            actions: ({ context }) => {
              logger.info(
                { totalCount: context.workers.length },
                "Capture coordinator initialized",
              );
            },
          },
          {
            target: "terminated",
            actions: [
              assign({
                lastInitFailure: ({ event }) =>
                  event.output.ok ? undefined : event.output.error,
              }),
              ({ event }) => {
                if (!event.output.ok) {
                  logger.error(
                    { failure: event.output.error },
                    "Worker initialization failed",
                  );
                }
              },
            ],
          },
        ],
      },
    },
    running: {
      invoke: {
        src: "watchWorkerHealth",
        input: ({ context }) => context.workers,
      },
      on: {
        SHUTDOWN: "shuttingDown",
        ALL_WORKERS_ERROR: "shuttingDown",
      },
    },
    shuttingDown: {
      invoke: {
        src: "shutdownWorkers",
        input: ({ context }) => ({ workers: context.workers }),
        onDone: [
          {
            guard: ({ event }) => event.output.ok,
            target: "terminated",
            actions: () => {
              logger.info("Capture coordinator shut down");
            },
          },
          {
            target: "terminated",
            actions: ({ event }) => {
              if (!event.output.ok) {
                logger.warn(
                  { failure: event.output.error },
                  "Capture coordinator shut down with timeout",
                );
              }
            },
          },
        ],
      },
    },
    terminated: {
      type: "final",
    },
  },
});

/** Coordinator lifecycle state derived from machine state names */
export type CoordinatorLifecycle = StateValueFrom<typeof coordinatorMachine>;

export const ALL_COORDINATOR_LIFECYCLES = Object.keys(
  coordinatorMachine.config.states ?? {}
) as CoordinatorLifecycle[];
