/**
 * Coordinator Machine
 *
 * XState v5 machine definition for the capture coordinator lifecycle.
 * Manages the lifecycle states while CaptureCoordinator class handles
 * spawning and managing worker status actors (Parent-Child Actor Model).
 *
 * Replaces coordinator-lifecycle.ts.
 */
import { setup, type StateValueFrom } from "xstate";

export const coordinatorMachine = setup({
  types: {
    events: {} as
      | { type: "INITIALIZE" }
      | { type: "INIT_DONE" }
      | { type: "INIT_FAILED" }
      | { type: "SHUTDOWN" }
      | { type: "SHUTDOWN_DONE" }
      | { type: "ALL_WORKERS_ERROR" },
  },
}).createMachine({
  id: "coordinator",
  initial: "created",
  states: {
    created: {
      on: { INITIALIZE: "initializing" },
    },
    initializing: {
      on: {
        INIT_DONE: "running",
        INIT_FAILED: "stopped",
      },
    },
    running: {
      on: {
        SHUTDOWN: "shuttingDown",
        ALL_WORKERS_ERROR: "shuttingDown",
      },
    },
    shuttingDown: {
      on: { SHUTDOWN_DONE: "stopped" },
    },
    stopped: {
      type: "final",
    },
  },
});

/** Coordinator lifecycle state derived from machine state names */
export type CoordinatorLifecycle = StateValueFrom<typeof coordinatorMachine>;

export const ALL_COORDINATOR_LIFECYCLES = Object.keys(
  coordinatorMachine.config.states ?? {}
) as CoordinatorLifecycle[];
