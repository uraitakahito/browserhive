/**
 * Error Type
 *
 * Unified error type definitions. Manages types and Proto mappings in one place.
 */
import { ErrorType as ProtoErrorType } from "../grpc/generated/browserhive/v1/capture.js";

export const ERROR_TYPE_DEFINITIONS = {
  http: {
    proto: ProtoErrorType.ERROR_TYPE_HTTP,
  },
  timeout: {
    proto: ProtoErrorType.ERROR_TYPE_TIMEOUT,
  },
  connection: {
    proto: ProtoErrorType.ERROR_TYPE_CONNECTION,
  },
  internal: {
    proto: ProtoErrorType.ERROR_TYPE_INTERNAL,
  },
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

/**
 * Convert TypeScript ErrorType to Proto ErrorType
 */
export const errorTypeToProto = (type: ErrorType): ProtoErrorType => {
  return ERROR_TYPE_DEFINITIONS[type].proto;
};
