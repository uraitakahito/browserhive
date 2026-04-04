/**
 * Error Type
 *
 * Unified error type definitions.
 * Proto mappings are handled by grpc/response-mapper.ts.
 */
export const ERROR_TYPE_DEFINITIONS = {
  http: {},
  timeout: {},
  connection: {},
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
  internal: "internal",
} as const satisfies Record<ErrorType, ErrorType>;

export const ALL_ERROR_TYPES = Object.keys(
  ERROR_TYPE_DEFINITIONS
) as ErrorType[];
