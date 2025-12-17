/**
 * Error Details Builder
 *
 * Utility functions for constructing ErrorDetails objects.
 */
import { errorType } from "./error-type.js";
import type { ErrorDetails } from "./types.js";

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

export const createTimeoutError = (
  timeoutMs: number,
  operation: string
): ErrorDetails => ({
  type: errorType.timeout,
  message: `Timeout: ${operation} (${String(timeoutMs)}ms)`,
  timeoutMs,
});

export const createConnectionError = (reason: string): ErrorDetails => ({
  type: errorType.connection,
  message: reason,
});

export const createInternalError = (message: string): ErrorDetails => ({
  type: errorType.internal,
  message,
});

export const errorDetailsFromException = (error: unknown): ErrorDetails => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Timeout")) {
    // Extract ms value from timeout message (e.g., "Timeout: Navigation (30000ms)")
    const match = /\((\d+)ms\)/.exec(message);
    const details: ErrorDetails = {
      type: errorType.timeout,
      message,
    };
    if (match?.[1] !== undefined) {
      details.timeoutMs = parseInt(match[1], 10);
    }
    return details;
  }

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
