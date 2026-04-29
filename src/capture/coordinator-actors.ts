/**
 * Coordinator Actors
 *
 * Actor logic implementations invoked by the coordinator state machine
 * (see coordinator-machine.ts) during the `initializing`, `running`, and
 * `shuttingDown` lifecycle states.
 *
 * Actor logics defined here:
 *   - `initializeWorkers` (fromPromise): connect all worker actors and
 *     verify at least one becomes operational
 *   - `watchWorkerHealth` (fromCallback): emit ALL_WORKERS_ERROR when every
 *     worker becomes unhealthy
 *   - `shutdownWorkers` (fromPromise): disconnect all worker actors with a
 *     timeout fallback
 */
import { fromCallback, fromPromise } from "xstate";
import { logger } from "../logger.js";
import type { WorkerEntry } from "./coordinator-machine.js";

/** Timeout for waiting all worker actors to settle during initialization */
const WORKER_INIT_TIMEOUT_MS = 30_000;

/** Timeout for waiting worker actors to disconnect during shutdown */
const WORKER_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Wait for every worker actor to leave the transient `connecting` state —
 * either reaching `operational` (compound state object) or `error`.
 * Falls back to a timeout to avoid blocking indefinitely on a stuck connect.
 */
const waitForWorkersToSettle = async (
  workers: WorkerEntry[],
): Promise<void> => {
  const isSettled = (value: unknown): boolean =>
    (typeof value === "object" && value !== null) || value === "error";

  await Promise.race([
    Promise.all(
      workers.map(
        (entry) =>
          new Promise<void>((resolve) => {
            if (isSettled(entry.ref.getSnapshot().value)) {
              resolve();
              return;
            }
            const subscription = entry.ref.subscribe((snapshot) => {
              if (isSettled(snapshot.value)) {
                subscription.unsubscribe();
                resolve();
              }
            });
          }),
      ),
    ),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.warn(
          { timeoutMs: WORKER_INIT_TIMEOUT_MS },
          "Worker initialization timed out, proceeding with available workers",
        );
        resolve();
      }, WORKER_INIT_TIMEOUT_MS),
    ),
  ]);
};

/**
 * Wait for every worker actor to reach the `disconnected` state, with a
 * timeout fallback so a stuck worker can't block coordinator shutdown.
 */
const waitForWorkersToDisconnect = async (
  workers: WorkerEntry[],
): Promise<void> => {
  await Promise.race([
    Promise.all(
      workers.map(
        (entry) =>
          new Promise<void>((resolve) => {
            if (entry.ref.getSnapshot().value === "disconnected") {
              resolve();
              return;
            }
            const subscription = entry.ref.subscribe((snapshot) => {
              if (snapshot.value === "disconnected") {
                subscription.unsubscribe();
                resolve();
              }
            });
          }),
      ),
    ),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.warn(
          { timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
          "Worker shutdown timed out, proceeding to disconnect",
        );
        resolve();
      }, WORKER_SHUTDOWN_TIMEOUT_MS),
    ),
  ]);
};

const countOperational = (workers: WorkerEntry[]): number =>
  workers.filter((entry) => entry.ref.getSnapshot().hasTag("healthy")).length;

export const initializeWorkers = fromPromise<undefined, { workers: WorkerEntry[] }>(
  async ({ input }) => {
    for (const entry of input.workers) {
      entry.ref.send({ type: "CONNECT" });
    }
    await waitForWorkersToSettle(input.workers);
    const operationalCount = countOperational(input.workers);
    if (operationalCount === 0) {
      throw new Error(
        "No workers available. All browser connections failed.",
      );
    }
    logger.info(
      { operationalCount, totalCount: input.workers.length },
      "Capture coordinator initialized",
    );
  },
);

export const watchWorkerHealth = fromCallback<{ type: "noop" }, WorkerEntry[]>(
  ({ sendBack, input }) => {
    const subscriptions = input.map((entry) =>
      entry.ref.subscribe(() => {
        const allUnhealthy = input.every(
          (w) => !w.ref.getSnapshot().hasTag("healthy"),
        );
        if (allUnhealthy && input.length > 0) {
          logger.error("All workers are unhealthy, initiating shutdown");
          sendBack({ type: "ALL_WORKERS_ERROR" });
        }
      }),
    );
    return () => {
      subscriptions.forEach((sub) => { sub.unsubscribe(); });
    };
  },
);

export const shutdownWorkers = fromPromise<undefined, { workers: WorkerEntry[] }>(
  async ({ input }) => {
    for (const entry of input.workers) {
      entry.ref.send({ type: "DISCONNECT" });
    }
    await waitForWorkersToDisconnect(input.workers);
    await Promise.all(
      input.workers.map(async (entry) => {
        await entry.worker.disconnect();
      }),
    );
    logger.info("Capture coordinator shut down");
  },
);
