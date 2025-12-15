/**
 * Worker Status
 *
 * Unified status definitions. Manages types, Proto mappings, and state configurations all in one place.
 */
import { WorkerStatus as ProtoWorkerStatus } from "../grpc/generated/browserhive/v1/capture.js";

export const WORKER_STATUS_DEFINITIONS = {
  idle: {
    proto: ProtoWorkerStatus.WORKER_STATUS_IDLE,
    canProcess: true,
    healthy: true,
    allowedTransitions: ["busy", "error", "stopped"] as const,
  },
  busy: {
    proto: ProtoWorkerStatus.WORKER_STATUS_BUSY,
    canProcess: false,
    healthy: true,
    allowedTransitions: ["idle", "error", "stopped"] as const,
  },
  error: {
    proto: ProtoWorkerStatus.WORKER_STATUS_ERROR,
    canProcess: false,
    healthy: false,
    allowedTransitions: ["idle", "stopped"] as const,
  },
  stopped: {
    proto: ProtoWorkerStatus.WORKER_STATUS_STOPPED,
    canProcess: false,
    healthy: false,
    allowedTransitions: ["idle", "error"] as const,
  },
} as const;

export type WorkerStatus = keyof typeof WORKER_STATUS_DEFINITIONS;

export const ALL_WORKER_STATUSES = Object.keys(
  WORKER_STATUS_DEFINITIONS
) as WorkerStatus[];

/**
 * Convert TypeScript WorkerStatus to Proto WorkerStatus
 */
export const workerStatusToProto = (status: WorkerStatus): ProtoWorkerStatus => {
  return WORKER_STATUS_DEFINITIONS[status].proto;
};

export const canProcess = (status: WorkerStatus): boolean => {
  return WORKER_STATUS_DEFINITIONS[status].canProcess;
};

export const isHealthyStatus = (status: WorkerStatus): boolean => {
  return WORKER_STATUS_DEFINITIONS[status].healthy;
};

export const canTransitionTo = (
  from: WorkerStatus,
  to: WorkerStatus
): boolean => {
  return (
    WORKER_STATUS_DEFINITIONS[from].allowedTransitions as readonly WorkerStatus[]
  ).includes(to);
};
