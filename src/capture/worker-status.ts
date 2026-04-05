/**
 * Worker Status
 *
 * XState machine definition for worker status transitions.
 * Proto mappings are handled by grpc/response-mapper.ts.
 */
import { setup, type StateValueFrom, type EventFromLogic } from "xstate";

export const workerStatusMachine = setup({
  types: {
    events: {} as
      | { type: "TO_READY" }
      | { type: "TO_BUSY" }
      | { type: "TO_ERROR" }
      | { type: "TO_STOPPED" },
  },
}).createMachine({
  id: "workerStatus",
  initial: "stopped",
  states: {
    ready: {
      tags: ["canProcess", "healthy"],
      on: { TO_BUSY: "busy", TO_ERROR: "error", TO_STOPPED: "stopped" },
    },
    busy: {
      tags: ["healthy"],
      on: { TO_READY: "ready", TO_ERROR: "error", TO_STOPPED: "stopped" },
    },
    error: {
      on: { TO_READY: "ready", TO_STOPPED: "stopped" },
    },
    stopped: {
      on: { TO_READY: "ready", TO_ERROR: "error" },
    },
  },
});

/** Worker status derived from machine state names */
export type WorkerStatus = StateValueFrom<typeof workerStatusMachine>;

/** Worker status event derived from machine event types */
export type WorkerStatusEvent = EventFromLogic<typeof workerStatusMachine>;

export const ALL_WORKER_STATUSES: WorkerStatus[] = ["ready", "busy", "error", "stopped"];
