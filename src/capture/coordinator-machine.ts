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
} from "xstate";
import type { BrowserProfile, CoordinatorConfig } from "../config/index.js";
import type { ArtifactStore } from "../storage/index.js";
import { logger } from "../logger.js";
import {
  initializeWorkers,
  retryFailedWorkers,
  shutdownWorkers,
  watchWorkerHealth,
} from "./coordinator-actors.js";
import { TaskQueue } from "./task-queue.js";
import { BrowserClient } from "./browser-client.js";
import { CaptureWorker, captureWorkerMachine } from "./capture-worker.js";

export interface CoordinatorMachineContext {
  config: CoordinatorConfig;
  store: ArtifactStore;
  taskQueue: TaskQueue;
  /**
   * The membership target — the profiles that *should* have a worker. The
   * source of truth for spawning, decoupled from `config.browserProfiles`:
   * a WorkerRegistry supplies it (initially via SET_MEMBERS, and later — in
   * the dynamic design — via MEMBERSHIP_CHANGED). Seeded from config so the
   * machine is self-sufficient when driven directly (e.g. in tests).
   */
  desiredMembers: BrowserProfile[];
  workers: CaptureWorker[];
}

export interface CoordinatorMachineInput {
  config: CoordinatorConfig;
  store: ArtifactStore;
}

/**
 * 親の状態機械。`browserProfiles` ごとにワーカーを spawn し、全体の健全性
 * (`active.running` / `active.degraded`)とシャットダウンを管理する。
 *
 * @glossary coordinatorMachine
 * @category コンポーネント
 */
export const coordinatorMachine = setup({
  types: {
    context: {} as CoordinatorMachineContext,
    input: {} as CoordinatorMachineInput,
    events: {} as
      | { type: "INITIALIZE" }
      | { type: "SET_MEMBERS"; members: BrowserProfile[] }
      | { type: "SHUTDOWN" }
      | { type: "WORKER_DEGRADED" }
      | { type: "ALL_WORKERS_HEALTHY" },
  },
  actors: {
    captureWorker: captureWorkerMachine,
    initializeWorkers,
    watchWorkerHealth,
    retryFailedWorkers,
    shutdownWorkers,
  },
}).createMachine({
  id: "coordinatorLifecycle",
  initial: "created",
  context: ({ input }): CoordinatorMachineContext => ({
    config: input.config,
    store: input.store,
    taskQueue: new TaskQueue(),
    desiredMembers: input.config.browserProfiles,
    workers: [],
  }),
  states: {
    created: {
      on: {
        // The coordinator resolves membership from its WorkerRegistry and
        // sets it here before INITIALIZE; without it, the config default stands.
        SET_MEMBERS: {
          actions: assign({ desiredMembers: ({ event }) => event.members }),
        },
        INITIALIZE: "initializing",
      },
    },
    initializing: {
      // #region spawn-workers
      entry: assign({
        workers: ({ context, spawn }): CaptureWorker[] =>
          context.desiredMembers.map((profile, index) => {
            const client = new BrowserClient(index, profile, context.store);
            const ref = spawn("captureWorker", {
              id: `worker-${String(index)}`,
              input: {
                maxRetryCount: context.config.maxRetryCount,
                runtime: {
                  client,
                  taskQueue: context.taskQueue,
                  pollIntervalMs: context.config.queuePollIntervalMs,
                },
              },
            });
            return new CaptureWorker(ref, client);
          }),
      }),
      // #endregion
      invoke: {
        src: "initializeWorkers",
        input: ({ context }): { workers: CaptureWorker[] } => ({ workers: context.workers }),
        onDone: [
          {
            guard: ({ event }) => event.output.allHealthy,
            target: "active.running",
            actions: ({ context }) => {
              logger.info(
                { totalCount: context.workers.length },
                "Capture coordinator initialized",
              );
            },
          },
          {
            target: "active.degraded",
            actions: ({ event, context }) => {
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
        input: ({ context }): { workers: CaptureWorker[] } => ({ workers: context.workers }),
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
