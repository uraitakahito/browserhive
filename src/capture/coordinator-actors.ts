/**
 * Coordinator Actors
 *
 * Actor logic implementations invoked by the coordinator state machine
 * (see coordinator-machine.ts) during the `initializing`, `running`, and
 * `shuttingDown` lifecycle states.
 *
 * Actor logics defined here:
 *   - `initializeWorkers` (fromPromise): connect all worker actors and
 *     verify every one becomes operational
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
 * Wait for every worker actor to reach a state matching `predicate`, falling
 * back to a timeout to avoid blocking on a stuck worker.
 *
 * Cleans up on exit (regardless of which side of the race won):
 *   - Cancels the pending timeout (so `onTimeout` does not fire after success)
 *   - Unsubscribes from every worker actor (so listeners do not leak)
 */
export const waitForWorkersToReach = async (
  workers: WorkerEntry[],
  predicate: (value: unknown) => boolean,
  options: { timeoutMs: number; onTimeout: () => void },
): Promise<void> => {
  const subscriptions: { unsubscribe: () => void }[] = [];
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.all(
        workers.map(
          (entry) =>
            new Promise<void>((resolve) => {
              if (predicate(entry.ref.getSnapshot().value)) {
                resolve();
                return;
              }
              const sub = entry.ref.subscribe((snapshot) => {
                if (predicate(snapshot.value)) resolve();
              });
              subscriptions.push(sub);
            }),
        ),
      ),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          options.onTimeout();
          timeoutId = undefined;
          resolve();
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    for (const sub of subscriptions) sub.unsubscribe();
  }
};

const isSettled = (value: unknown): boolean =>
  (typeof value === "object" && value !== null) || value === "error";

const countOperational = (workers: WorkerEntry[]): number =>
  workers.filter((entry) => entry.ref.getSnapshot().hasTag("healthy")).length;

export const initializeWorkers = fromPromise<undefined, { workers: WorkerEntry[] }>(
  async ({ input }) => {
    if (input.workers.length === 0) {
      throw new Error("No browser profiles configured.");
    }
    for (const entry of input.workers) {
      entry.ref.send({ type: "CONNECT" });
    }
    await waitForWorkersToReach(input.workers, isSettled, {
      timeoutMs: WORKER_INIT_TIMEOUT_MS,
      onTimeout: () => {
        logger.warn(
          { timeoutMs: WORKER_INIT_TIMEOUT_MS },
          "Worker initialization timed out, some workers did not settle",
        );
      },
    });
    const totalCount = input.workers.length;
    const operationalCount = countOperational(input.workers);
    if (operationalCount < totalCount) {
      const failedProfiles = input.workers
        .filter((entry) => !entry.ref.getSnapshot().hasTag("healthy"))
        .map((entry) => entry.worker.profile.browserURL);
      throw new Error(
        `Worker initialization failed: ${String(operationalCount)}/${String(totalCount)} operational. ` +
          `Failed: [${failedProfiles.join(", ")}]`,
      );
    }
    logger.info(
      { totalCount },
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
    await waitForWorkersToReach(
      input.workers,
      (value) => value === "disconnected",
      {
        timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS,
        onTimeout: () => {
          logger.warn(
            { timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
            "Worker shutdown timed out, proceeding to disconnect",
          );
        },
      },
    );
    await Promise.all(
      input.workers.map(async (entry) => {
        await entry.worker.disconnect();
      }),
    );
    logger.info("Capture coordinator shut down");
  },
);
