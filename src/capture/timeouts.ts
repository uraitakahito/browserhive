/**
 * A capture runs against two clocks, and mixing them up breaks things quietly.
 * They are separate functions so the name forces a choice at every call site.
 *
 *   withOperationTimeout — Layer A. "Is this one operation stuck?"
 *     Exists because a JS redirect can leave `page.evaluate` waiting for an
 *     execution context that never arrives, which hangs the worker with no
 *     exception. It bounds the operation, so it must NOT count pauses we
 *     inserted ourselves in order to watch the capture.
 *
 *   withWallClockTimeout — Layer B. "Has this task taken too long?"
 *     A ceiling on real elapsed time. Pauses we inserted are real elapsed
 *     time, so here they DO count. Subtracting them would let a large
 *     `operationDelayMs` keep a task alive indefinitely — the exact thing
 *     this budget exists to prevent.
 *
 * The distinction is not academic. `operationDelayMs` sleeps before each
 * browser call, and those sleeps used to be charged to Layer A: a 3s
 * dynamic-content wait against a 5s budget failed for any delay of ~2s or
 * more, and the API accepted delays up to 5s. Every one of those captures was
 * accepted and then failed three times over.
 */
import type { PacingLedger } from "./capture-page.js";
import { TimeoutError } from "./error-details.js";

/**
 * Race `promise` against `ms`, reporting which won rather than throwing.
 *
 * Returning the outcome (instead of rejecting) is what lets the caller decide
 * whether an expiry is real or should be forgiven and re-raced.
 *
 * Plain `setTimeout` rather than the promise-based timers API: this is the
 * pattern the rest of the capture path uses, and it is the one the suite's
 * fake timers drive reliably. The handle is always cleared, including on the
 * winning path — a stray pending timer would keep the process alive after the
 * capture is done.
 */
const raceForMs = async <T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> => {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ settled: false });
    }, ms);
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true as const, value })),
      expiry,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Bound the time spent ON `promise`, excluding any pacing injected while it ran.
 *
 * ## Why this is not a plain race
 *
 * `operationDelayMs` sleeps inside the operation, so a plain race charges the
 * pause to the operation's budget. The pause is ours, not the page's, and the
 * budget exists to detect a stuck page.
 *
 * ## Why not simply add the delay to the budget
 *
 * Because the number of pauses inside one budget is not fixed. `runBehaviors`
 * makes three paced calls; a plain `budget + delay` would be wrong there, and
 * `budget + 3 * delay` becomes wrong the moment someone adds a fourth. The
 * coefficient lives far from the code it describes and drifts silently — and
 * it only misbehaves when pacing is on, which is rare enough that nobody
 * notices for a long time.
 *
 * ## How it works instead
 *
 * When the deadline fires, ask the ledger how much pacing was injected since
 * we started and push the deadline out by that much, then keep waiting. The
 * effect is that the clock stopped while we were sleeping. Nothing counts
 * pauses, so nothing goes stale.
 *
 * ## Why the loop
 *
 * More pacing can be injected after an extension (the next paced call inside
 * the same operation). Each pass extends only if the injected total actually
 * grew; when it stops growing, the operation itself is overrunning and the
 * timeout fires for real. The total is bounded by (paced calls × delay), so
 * the loop terminates.
 *
 * A page that never settles is therefore still caught: it issues no further
 * paced calls, the ledger stops growing, and the deadline stops moving.
 */
export const withOperationTimeout = async <T>(
  promise: Promise<T>,
  budgetMs: number,
  operation: string,
  pacing: PacingLedger,
): Promise<T> => {
  const injectedAtStart = pacing.injectedMs;
  let deadlineMs = budgetMs;
  let waitedMs = 0;

  for (;;) {
    const outcome = await raceForMs(promise, deadlineMs - waitedMs);
    if (outcome.settled) return outcome.value;

    waitedMs = deadlineMs;

    // Yield before reading the ledger. A pause that ends on the very tick the
    // deadline fires records itself in a microtask continuation, so reading
    // straight away can miss it and declare a timeout for time we ourselves
    // spent sleeping. Two hops covers the promise plumbing between the sleep
    // resolving and the ledger being written.
    await Promise.resolve();
    await Promise.resolve();

    const injectedSinceStart = pacing.injectedMs - injectedAtStart;
    const extendedMs = budgetMs + injectedSinceStart;

    // No growth means the time went to the operation, not to our pauses.
    if (extendedMs <= deadlineMs) {
      throw new TimeoutError({ operation, timeoutMs: budgetMs });
    }
    deadlineMs = extendedMs;
  }
};

/**
 * Bound real elapsed time for `promise`.
 *
 * Used for the whole-task ceiling. Deliberately unaware of pacing: time spent
 * paused is time the task really took, and a task slowed on purpose is still
 * a slow task.
 */
export const withWallClockTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> => {
  const outcome = await raceForMs(promise, timeoutMs);
  if (outcome.settled) return outcome.value;
  throw new TimeoutError({ operation, timeoutMs });
};
