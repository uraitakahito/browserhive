/**
 * Coordinator Actors
 *
 * Actor logic implementations invoked by the coordinator state machine
 * (see coordinator-machine.ts) during the `initializing`, `running`, and
 * `shuttingDown` lifecycle states.
 *
 * Actor logics defined here:
 *   - `initializeWorkers` (fromPromise): connect all worker actors and
 *     report whether all reached operational. Never fails — the machine
 *     branches on `event.output.allHealthy` to choose `running` vs
 *     `degraded`.
 *   - `watchWorkerHealth` (fromCallback): observe-only (informational).
 *     Reserved for future re-purposing in Phase 2.
 *   - `shutdownWorkers` (fromPromise): disconnect all worker actors and
 *     return Result<void, ShutdownFailure>. Treats the disconnect
 *     timeout as a structured failure (still proceeds to disconnect).
 */
import { fromCallback, fromPromise } from "xstate";
import { logger } from "../logger.js";
import { err, ok, type Result } from "../result.js";
import type { WorkerEntry } from "./coordinator-machine.js";
import type {
  ShutdownFailure,
  WorkerInitFailure,
} from "./coordinator-errors.js";
import { createConnectionError } from "./error-details.js";

/** Timeout for waiting all worker actors to settle during initialization */
const WORKER_INIT_TIMEOUT_MS = 30_000;

/** Timeout for waiting worker actors to disconnect during shutdown */
const WORKER_SHUTDOWN_TIMEOUT_MS = 5000;

/** Initial delay between reconnect attempts in `degraded` (ms) */
const RETRY_BASE_DELAY_MS = 1000;

/** Upper bound for the exponential reconnect backoff (ms) */
const RETRY_MAX_DELAY_MS = 60_000;

/** Output of `initializeWorkers` — never an error case */
export interface InitializeWorkersOutput {
  allHealthy: boolean;
  failed: WorkerInitFailure[];
}

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

const collectFailedWorkers = (workers: WorkerEntry[]): WorkerInitFailure[] =>
  workers
    .filter((entry) => !entry.ref.getSnapshot().hasTag("healthy"))
    .map((entry) => {
      const lastError = entry.ref.getSnapshot().context.errorHistory[0];
      return {
        browserURL: entry.client.profile.browserURL,
        reason:
          lastError ??
          createConnectionError("Unknown failure (no error recorded)"),
      };
    });

export const initializeWorkers = fromPromise<
  InitializeWorkersOutput,
  { workers: WorkerEntry[] }
>(async ({ input }) => {
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
  const operationalCount = countOperational(input.workers);
  const allHealthy = operationalCount === input.workers.length;
  if (!allHealthy) {
    const failed = collectFailedWorkers(input.workers);
    logger.warn(
      {
        operational: operationalCount,
        total: input.workers.length,
        failed,
      },
      "Worker initialization completed with failures",
    );
    return { allHealthy: false, failed };
  }
  return { allHealthy: true, failed: [] };
});

/**
 * Subscribe to every worker actor and emit lifecycle events to the parent
 * coordinator machine when the global health flips:
 *   - any worker unhealthy (and previously all healthy) → WORKER_DEGRADED
 *   - all workers healthy (and previously some unhealthy) → ALL_WORKERS_HEALTHY
 *
 * The actor is invoked from both `running` and `degraded`. It seeds the
 * "previously" state from the current snapshot at subscription time, so each
 * invocation only emits transitions observed during its lifetime — the parent
 * machine drops events that are not handled in the current state anyway.
 */
export const watchWorkerHealth = fromCallback<
  { type: "WORKER_DEGRADED" } | { type: "ALL_WORKERS_HEALTHY" },
  WorkerEntry[]
>(({ sendBack, input }) => {
  if (input.length === 0) return;

  const isAllHealthy = (): boolean =>
    input.every((entry) => entry.ref.getSnapshot().hasTag("healthy"));

  let lastAllHealthy = isAllHealthy();

  const subscriptions = input.map((entry) =>
    entry.ref.subscribe(() => {
      const allHealthy = isAllHealthy();
      if (allHealthy === lastAllHealthy) return;
      lastAllHealthy = allHealthy;
      if (allHealthy) {
        sendBack({ type: "ALL_WORKERS_HEALTHY" });
      } else {
        sendBack({ type: "WORKER_DEGRADED" });
      }
    }),
  );

  return () => {
    subscriptions.forEach((sub) => {
      sub.unsubscribe();
    });
  };
});

/**
 * Periodically send CONNECT to every worker currently in the `error`
 * state, with exponential backoff (1s → 2s → 4s → … capped at 60s).
 *
 * The actor is invoked from `degraded`. The cleanup function clears any
 * pending timer when the parent leaves `degraded`. Backoff resets on each
 * fresh invocation (i.e. on every entry into `degraded`).
 */
export const retryFailedWorkers = fromCallback<{ type: "noop" }, WorkerEntry[]>(
  ({ input }) => {
    let timeoutId: NodeJS.Timeout | undefined;
    let attempt = 0;
    let disposed = false;

    const scheduleNext = (): void => {
      const delay = Math.min(
        RETRY_MAX_DELAY_MS,
        RETRY_BASE_DELAY_MS * 2 ** attempt,
      );
      attempt += 1;
      timeoutId = setTimeout(() => {
        if (disposed) return;
        const targets = input.filter(
          (entry) => entry.ref.getSnapshot().value === "error",
        );
        if (targets.length > 0) {
          logger.info(
            {
              attempt,
              count: targets.length,
              browserURLs: targets.map((t) => t.client.profile.browserURL),
            },
            "Retrying failed workers",
          );
          for (const entry of targets) {
            entry.ref.send({ type: "CONNECT" });
          }
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      disposed = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  },
);

export const shutdownWorkers = fromPromise<
  Result<void, ShutdownFailure>,
  { workers: WorkerEntry[] }
>(async ({ input }) => {
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
  // Workers still outside "disconnected" indicate the wait timed out.
  // Snapshot before the safety-net disconnect below, which is idempotent
  // for already-settled workers but races the actor for stuck ones.
  const unsettled = input.workers
    .filter((entry) => entry.ref.getSnapshot().value !== "disconnected")
    .map((entry) => entry.client.profile.browserURL);
  await Promise.all(
    input.workers.map(async (entry) => {
      const result = await entry.client.disconnect();
      if (!result.ok) {
        logger.warn(
          {
            browserURL: entry.client.profile.browserURL,
            reason: result.error,
          },
          "Safety-net disconnect failed",
        );
      }
    }),
  );
  if (unsettled.length > 0) {
    return err({
      kind: "timeout",
      timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS,
      unsettled,
    });
  }
  return ok();
});
