/**
 * Error Details Builder
 *
 * Utility functions for constructing ErrorDetails objects, plus the
 * `TimeoutError` class thrown by `withTimeout` (`page-capturer.ts`).
 *
 * `TimeoutError` carries `operation` and `timeoutMs` as typed fields so
 * downstream classification (`errorDetailsFromException`) can identify it
 * via `instanceof` rather than message-string heuristics. The `message`
 * format is preserved (`"Timeout: <op> (<ms>ms)"`) for wire compatibility
 * with `errorRecord.message`.
 */
import { TimeoutError as PuppeteerTimeoutError } from "puppeteer";
import { errorType } from "./error-type.js";
import type { ErrorDetails } from "./types.js";

export { PuppeteerTimeoutError };

/**
 * Pull the milliseconds budget out of a `puppeteer.TimeoutError` message.
 *
 * Puppeteer renders timeout messages in a few related shapes — see
 * `node_modules/puppeteer-core/.../LifecycleWatcher.js`,
 * `WaitTask.js`, etc.:
 *
 *   - `"Navigation timeout of 30000 ms exceeded"`              (with space)
 *   - `"Waiting failed: 100ms exceeded"`                       (no space)
 *   - "Waiting for `FileChooser` failed: 5000ms exceeded"      (no space)
 *
 * The shared tail is `<N><opt-space>ms<space>+exceeded`. Returns `undefined`
 * when the message does not match the pattern, so the caller can leave
 * `ErrorDetails.timeoutMs` unset rather than fabricating a value.
 *
 * Exported for direct unit testing.
 */
export const extractPuppeteerTimeoutMs = (message: string): number | undefined => {
  const match = /(\d+)\s*ms\s+exceeded/.exec(message);
  if (!match?.[1]) return undefined;
  return parseInt(match[1], 10);
};

export class TimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor({ operation, timeoutMs }: { operation: string; timeoutMs: number }) {
    super(`Timeout: ${operation} (${String(timeoutMs)}ms)`);
    this.name = "TimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Standard HTTP status text mapping
 * Used as fallback when HTTP/2 doesn't provide status text
 */
const HTTP_STATUS_TEXT: Record<number, string> = {
  // 3xx Redirection
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  // 4xx Client Error
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  429: "Too Many Requests",
  // 5xx Server Error
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/**
 * Get HTTP status text, using standard mapping as fallback for HTTP/2
 */
const getHttpStatusText = (
  statusCode: number,
  statusText?: string
): string | undefined => {
  // Use provided statusText if non-empty
  if (statusText && statusText.length > 0) {
    return statusText;
  }
  // Fall back to standard mapping
  return HTTP_STATUS_TEXT[statusCode];
};

export const createHttpError = (
  statusCode: number,
  statusText?: string
): ErrorDetails => {
  const resolvedStatusText = getHttpStatusText(statusCode, statusText);
  const details: ErrorDetails = {
    type: errorType.http,
    message: resolvedStatusText
      ? `HTTP ${String(statusCode)}: ${resolvedStatusText}`
      : `HTTP ${String(statusCode)}`,
    httpStatusCode: statusCode,
  };
  if (resolvedStatusText !== undefined) {
    details.httpStatusText = resolvedStatusText;
  }
  return details;
};

export const createConnectionError = (reason: string): ErrorDetails => ({
  type: errorType.connection,
  message: reason,
});

export const createInternalError = (message: string): ErrorDetails => ({
  type: errorType.internal,
  message,
});

/**
 * Identify puppeteer's "Execution context was destroyed, most likely because
 * of a navigation." rejection.
 *
 * ## Why this is a *named* predicate rather than just message-grep
 *
 * The destroyed-context exception is unique among puppeteer errors in that
 * it is **not** an error from the user's perspective — it is the signal
 * that the page performed a navigation while we were holding a handle to
 * the previous frame. Treating it as a regular failure would push
 * recoverable URLs into errorHistory and lose the screenshot.
 *
 * Concrete production URLs (data/js-redirect.csv) that throw this
 * exception on every attempt because they redirect immediately after
 * the initial DOMContentLoaded:
 *
 *   * https://www.imhds.co.jp/        →  /corporate/index_en.html
 *   * https://www.itochu.co.jp/       →  /ja/
 *   * https://www.daiwahouse.com/     →  /jp/    (locale negotiation)
 *
 * Used by `runOnStableContext` in `page-capturer.ts` to decide whether a
 * rejection is the recoverable redirect signal (retry) or a genuine error
 * (propagate).
 *
 * ## Why this stays message-based
 *
 * Puppeteer does not export a dedicated error class for this case — both
 * the CDP-level and protocol-level paths surface a plain `Error` with
 * only `message` populated. The wording has been stable across puppeteer
 * 19.x — 24.x, so a case-insensitive substring match on
 * `"Execution context was destroyed"` is the contract here. If a future
 * puppeteer release ever introduces a typed class for it, swap to
 * `instanceof` here without touching call sites.
 */
export const isExecutionContextDestroyed = (error: unknown): error is Error =>
  error instanceof Error &&
  /Execution context was destroyed/i.test(error.message);

/**
 * Identify a Puppeteer-emitted `TimeoutError` resiliently against the
 * CJS/ESM dual-package hazard.
 *
 * `puppeteer-extra` (used by `src/browser.ts`) is published as CJS, so it
 * `require()`s `puppeteer-core` through the CJS branch of that package's
 * `exports` map. Our own `import { TimeoutError as PuppeteerTimeoutError }
 * from "puppeteer"` above resolves through the ESM branch. The CJS and
 * ESM copies of `puppeteer-core/.../Errors.js` evaluate as independent
 * modules under Node's loader, so the two `TimeoutError` classes have
 * distinct identities even though they share source. `instanceof
 * PuppeteerTimeoutError` therefore misses errors thrown from inside a
 * puppeteer-extra-driven session — which is every error this server
 * sees in production.
 *
 * Match structurally instead: the error's own constructor must be named
 * `TimeoutError`, and somewhere up its prototype chain there must be a
 * constructor named `PuppeteerError`. That pair is unique to puppeteer's
 * own error hierarchy and won't false-positive on other libraries' or
 * our own `TimeoutError` (which extends `Error`, not `PuppeteerError`).
 */
const isPuppeteerTimeout = (error: unknown): error is Error => {
  if (error instanceof PuppeteerTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name !== "TimeoutError") return false;
  let proto = Object.getPrototypeOf(error) as object | null;
  while (proto) {
    const ctor = (proto as { constructor?: { name?: string } }).constructor;
    if (ctor?.name === "PuppeteerError") return true;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
};

/**
 * Classify an arbitrary thrown value into structured `ErrorDetails`.
 *
 * Classification is `instanceof`-first for our own `TimeoutError`, with a
 * structural duck check for puppeteer's `TimeoutError` to bypass the
 * CJS/ESM dual-package hazard documented on `isPuppeteerTimeout`. The
 * `connection` heuristic is intentionally still string-based — there is
 * no shared base class for the disconnect / "Connection closed" errors
 * Puppeteer surfaces, and broadening that is out of scope for the
 * timeout-classification fix.
 */
export const errorDetailsFromException = (error: unknown): ErrorDetails => {
  if (error instanceof TimeoutError) {
    return {
      type: errorType.timeout,
      message: error.message,
      timeoutMs: error.timeoutMs,
    };
  }

  if (isPuppeteerTimeout(error)) {
    const details: ErrorDetails = {
      type: errorType.timeout,
      message: error.message,
    };
    const timeoutMs = extractPuppeteerTimeoutMs(error.message);
    if (timeoutMs !== undefined) {
      details.timeoutMs = timeoutMs;
    }
    return details;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("disconnect") || message.includes("closed")) {
    return {
      type: errorType.connection,
      message,
    };
  }

  return {
    type: errorType.internal,
    message,
  };
};
