/**
 * Worker Status
 *
 * Unified status definitions. Manages types and state configurations in one place.
 * Proto mappings are handled by grpc/response-mapper.ts.
 */
export const WORKER_STATUS_DEFINITIONS = {
  ready: {
    canProcess: true,
    healthy: true,
    allowedTransitions: ["busy", "error", "stopped"] as const,
  },
  busy: {
    canProcess: false,
    healthy: true,
    allowedTransitions: ["ready", "error", "stopped"] as const,
  },
  error: {
    canProcess: false,
    healthy: false,
    allowedTransitions: ["ready", "stopped"] as const,
  },
  stopped: {
    canProcess: false,
    healthy: false,
    allowedTransitions: ["ready", "error"] as const,
  },
} as const;

export type WorkerStatus = keyof typeof WORKER_STATUS_DEFINITIONS;

export const ALL_WORKER_STATUSES = Object.keys(
  WORKER_STATUS_DEFINITIONS
) as WorkerStatus[];

