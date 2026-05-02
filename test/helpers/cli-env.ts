/**
 * CLI Test Helpers
 *
 * Set up an environment where commander's `program.error()` (which calls
 * `process.exit(1)`) can be observed in unit tests. `process.exit` is
 * replaced with a thrower; `process.stderr.write` is silenced so failure
 * tests do not pollute the test output.
 */
import { vi } from "vitest";

export const SERVER_ENV_VARS = [
  "BROWSERHIVE_PORT",
  "BROWSERHIVE_BROWSER_URLS",
  "BROWSERHIVE_OUTPUT_DIR",
  "BROWSERHIVE_PAGE_LOAD_TIMEOUT_MS",
  "BROWSERHIVE_CAPTURE_TIMEOUT_MS",
  "BROWSERHIVE_MAX_RETRY_COUNT",
  "BROWSERHIVE_QUEUE_POLL_INTERVAL_MS",
  "BROWSERHIVE_VIEWPORT_WIDTH",
  "BROWSERHIVE_VIEWPORT_HEIGHT",
  "BROWSERHIVE_SCREENSHOT_FULL_PAGE",
  "BROWSERHIVE_SCREENSHOT_QUALITY",
  "BROWSERHIVE_REJECT_DUPLICATE_URLS",
  "BROWSERHIVE_USER_AGENT",
  "BROWSERHIVE_ACCEPT_LANGUAGE",
  "BROWSERHIVE_TLS_CERT",
  "BROWSERHIVE_TLS_KEY",
] as const;

export const CLIENT_ENV_VARS = [
  "BROWSERHIVE_SERVER",
  "BROWSERHIVE_TLS_CA_CERT",
] as const;

export class ProcessExitError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit:${String(code)}`);
    this.code = code;
  }
}

/**
 * Stub the listed env vars to undefined, silence stderr, and replace
 * `process.exit` with a thrower. Tests that exercise `program.error` paths
 * can `expect(() => ...).toThrow(ProcessExitError)`.
 */
export const setupCliTestEnv = (envVars: readonly string[]): void => {
  for (const name of envVars) {
    vi.stubEnv(name, undefined);
  }
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(
    (code?: string | number | null) => {
      throw new ProcessExitError(typeof code === "number" ? code : 0);
    },
  );
};

export const teardownCliTestEnv = (): void => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
};

/** Build a fake `process.argv` for a CLI invocation. */
export const argv = (...rest: string[]): string[] => ["node", "browserhive", ...rest];
