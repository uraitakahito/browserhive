/**
 * Error Type
 *
 * Unified error type definitions.
 * Wire mappings are handled by http/response-mapper.ts.
 */
export const ERROR_TYPE_DEFINITIONS = {
  http: {},
  timeout: {},
  connection: {},
  /**
   * A signature was required and could not be obtained.
   *
   * Separate from `internal` because the fix is different in kind: a signing
   * service that is down is restarted and the capture retried, while
   * `internal` is where genuine bugs live. An operator reading a wave of
   * failures should not have to open each message to tell which they have.
   */
  signing: {},
  internal: {},
} as const;

export type ErrorType = keyof typeof ERROR_TYPE_DEFINITIONS;

/**
 * Error type constants for runtime use
 * Derived from ERROR_TYPE_DEFINITIONS keys for type safety
 */
export const errorType = {
  http: "http",
  timeout: "timeout",
  connection: "connection",
  signing: "signing",
  internal: "internal",
} as const satisfies Record<ErrorType, ErrorType>;

export const ALL_ERROR_TYPES = Object.keys(
  ERROR_TYPE_DEFINITIONS
) as ErrorType[];
