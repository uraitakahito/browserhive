/**
 * Coordinator Lifecycle
 *
 * XState machine definition for CaptureCoordinator lifecycle transitions.
 * Proto mappings are not needed (lifecycle is internal, not exposed via gRPC).
 */
import { setup, type StateValueFrom } from "xstate";

export const coordinatorLifecycleMachine = setup({}).createMachine({
  id: "coordinatorLifecycle",
  initial: "created",
  states: {
    created: {
      on: { INITIALIZE: "initializing" },
    },
    initializing: {
      on: { RUN: "running", STOP: "stopped" },
    },
    running: {
      tags: ["running"],
      on: { SHUT_DOWN: "shuttingDown" },
    },
    shuttingDown: {
      on: { STOP: "stopped" },
    },
    stopped: {
      type: "final",
    },
  },
});

/** Coordinator lifecycle state derived from machine state names */
export type CoordinatorLifecycle = StateValueFrom<typeof coordinatorLifecycleMachine>;

export const ALL_COORDINATOR_LIFECYCLES: CoordinatorLifecycle[] = [
  "created", "initializing", "running", "shuttingDown", "stopped",
];
