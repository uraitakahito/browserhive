/**
 * Coordinator Machine
 *
 * XState v5 machine definition for the capture coordinator lifecycle.
 * The machine spawns and orchestrates worker status actors via invoked
 * actors (Parent-Child Actor Model).
 *
 * Lifecycle shape: `running` and `degraded` are substates of the compound
 * `active` state. `watchWorkerHealth` and the `SHUTDOWN` transition are
 * invoked / handled at `active`, so they survive `running ↔ degraded`
 * oscillations. `retryFailedWorkers` is invoked only on `active.degraded`.
 *
 * Init policy: `initializeWorkers` is non-fatal — partial or total
 * connect failures land in `active.degraded` instead of `terminated`. Once
 * recovery brings every worker back to `operational`, `watchWorkerHealth`
 * emits `ALL_WORKERS_HEALTHY` to lift the lifecycle into `active.running`.
 *
 * Actor logics used (https://stately.ai/docs/actors#actor-logic-capabilities):
 *
 *   | Actor                                | Receive events | Send events | Spawn actors | Input | Output |
 *   | ------------------------------------ | -------------- | ----------- | ------------ | ----- | ------ |
 *   | `coordinatorMachine` (State machine) | yes            | yes         | yes          | yes   | yes    |
 *   | `workerStatus` (State machine)       | yes            | yes         | yes          | yes   | yes    |
 *   | `initializeWorkers` (Promise)        | no             | yes         | no           | yes   | yes    |
 *   | `watchWorkerHealth` (Callback)       | no             | yes         | no           | yes   | no     |
 *   | `retryFailedWorkers` (Callback)      | no             | no          | no           | yes   | no     |
 *   | `shutdownWorkers` (Promise)          | no             | yes         | no           | yes   | yes    |
 */
import {
  assign,
  setup,
  type ActorRefFrom,
} from "xstate";
import type { CoordinatorConfig } from "../config/index.js";
import { logger } from "../logger.js";
import {
  initializeWorkers,
  retryFailedWorkers,
  shutdownWorkers,
  watchWorkerHealth,
  type InitializeWorkersOutput,
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
  /** Most recent init outcome — informational only (does not gate the lifecycle). */
  lastInitSummary?: InitializeWorkersOutput;
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
      | { type: "WORKER_DEGRADED" }
      | { type: "ALL_WORKERS_HEALTHY" },
  },
  actors: {
    workerStatus: workerStatusMachine,
    initializeWorkers,
    watchWorkerHealth,
    retryFailedWorkers,
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
                maxRetryCount: context.config.maxRetryCount,
                runtime: {
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
            guard: ({ event }) => event.output.allHealthy,
            target: "active.running",
            actions: [
              assign({ lastInitSummary: ({ event }) => event.output }),
              ({ context }) => {
                logger.info(
                  { totalCount: context.workers.length },
                  "Capture coordinator initialized",
                );
              },
            ],
          },
          {
            target: "active.degraded",
            actions: [
              assign({ lastInitSummary: ({ event }) => event.output }),
              ({ event, context }) => {
                logger.warn(
                  {
                    operational:
                      context.workers.length - event.output.failed.length,
                    total: context.workers.length,
                    failed: event.output.failed,
                  },
                  "Capture coordinator started in degraded state",
                );
              },
            ],
          },
        ],
      },
    },
    active: {
      invoke: {
        src: "watchWorkerHealth",
        input: ({ context }) => context.workers,
      },
      on: { SHUTDOWN: "shuttingDown" },
      initial: "running",
      states: {
        running: {
          on: {
            WORKER_DEGRADED: {
              target: "degraded",
              actions: () => {
                logger.warn("Worker(s) became unhealthy, entering degraded");
              },
            },
          },
        },
        degraded: {
          invoke: {
            src: "retryFailedWorkers",
            input: ({ context }) => context.workers,
          },
          on: {
            ALL_WORKERS_HEALTHY: {
              target: "running",
              actions: () => {
                logger.info("All workers healthy, leaving degraded");
              },
            },
          },
        },
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

/**
 * Leaf states of the coordinator lifecycle. The two `active.*` entries are
 * dotted paths into the compound `active` state — usable directly as
 * `snapshot.matches(<leaf>)` arguments.
 */
export const ALL_COORDINATOR_LIFECYCLES = [
  "created",
  "initializing",
  "active.running",
  "active.degraded",
  "shuttingDown",
  "terminated",
] as const;

export type CoordinatorLifecycle = (typeof ALL_COORDINATOR_LIFECYCLES)[number];
