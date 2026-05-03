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
 * Classify an arbitrary thrown value into structured `ErrorDetails`.
 *
 * Classification is `instanceof`-first; the classes that can show up here
 * are enumerable (our own `TimeoutError`, puppeteer's `TimeoutError`).
 * The `connection` heuristic is intentionally still string-based — there
 * is no shared base class for the disconnect / "Connection closed" errors
 * Puppeteer surfaces, and broadening that to typed checks is out of scope
 * for the timeout-classification fix.
 */
export const errorDetailsFromException = (error: unknown): ErrorDetails => {
  if (error instanceof TimeoutError) {
    return {
      type: errorType.timeout,
      message: error.message,
      timeoutMs: error.timeoutMs,
    };
  }

  if (error instanceof PuppeteerTimeoutError) {
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
