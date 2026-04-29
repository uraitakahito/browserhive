/**
 * Coordinator Machine
 *
 * XState v5 machine definition for the capture coordinator lifecycle.
 * The machine spawns and orchestrates worker status actors via invoked
 * actors (Parent-Child Actor Model). Actor implementations live in
 * coordinator-actors.ts.
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
import {
  initializeWorkers,
  shutdownWorkers,
  watchWorkerHealth,
} from "./coordinator-actors.js";
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
  id: "coordinator",
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
        onDone: "running",
        onError: "terminated",
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
        onDone: "terminated",
        onError: "terminated",
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
