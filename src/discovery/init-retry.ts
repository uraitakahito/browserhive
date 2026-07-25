/**
 * Boot-time membership resolution with exponential backoff.
 *
 * A cold stack can start browserhive before the chromium workers' DNS names
 * are registered — `resolveMembers` throws when every declared host is
 * NXDOMAIN — so the *initial* resolve is retried a few times to absorb that
 * registration race. Once the attempts are spent the last error is rethrown, so
 * a genuinely worker-less stack still fails loudly. Used at startup only; the
 * runtime membership refresh already tolerates zero workers.
 */

export interface InitRetryOptions {
  /** Total attempts, including the first (>= 1). 1 = no retry. */
  attempts: number;
  /** Base delay (ms); the nth retry waits min(delayMs * 2^(n-1), maxDelayMs). */
  delayMs: number;
  /** Upper bound (ms) for the exponential backoff. */
  maxDelayMs: number;
}

export interface InitRetryHooks {
  /** Called before each backoff wait (not after the final, failing attempt). */
  onRetry?: (info: {
    attempt: number;
    of: number;
    delayMs: number;
    err: unknown;
  }) => void;
  /** Overridable for tests. Defaults to a setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const resolveWithInitRetry = async <T>(
  resolve: () => Promise<T>,
  opts: InitRetryOptions,
  hooks: InitRetryHooks = {},
): Promise<T> => {
  const sleep = hooks.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await resolve();
    } catch (error) {
      lastError = error;
      if (attempt === opts.attempts) break;
      const delayMs = Math.min(
        opts.delayMs * 2 ** (attempt - 1),
        opts.maxDelayMs,
      );
      hooks.onRetry?.({ attempt, of: opts.attempts, delayMs, err: error });
      await sleep(delayMs);
    }
  }
  throw lastError;
};
