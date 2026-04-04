/**
 * Coordinator Lifecycle
 *
 * Lifecycle state definitions for CaptureCoordinator.
 * Proto mappings are not needed (lifecycle is internal, not exposed via gRPC).
 */
export const COORDINATOR_LIFECYCLE_DEFINITIONS = {
  created: {
    allowedTransitions: ["initializing"] as const,
  },
  initializing: {
    allowedTransitions: ["running", "stopped"] as const,
  },
  running: {
    allowedTransitions: ["shuttingDown"] as const,
  },
  shuttingDown: {
    allowedTransitions: ["stopped"] as const,
  },
  stopped: {
    allowedTransitions: [] as const,
  },
} as const;

export type CoordinatorLifecycle = keyof typeof COORDINATOR_LIFECYCLE_DEFINITIONS;

export const ALL_COORDINATOR_LIFECYCLES = Object.keys(
  COORDINATOR_LIFECYCLE_DEFINITIONS
) as CoordinatorLifecycle[];
