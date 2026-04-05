/**
 * Coordinator Lifecycle
 *
 * XState machine definition for CaptureCoordinator lifecycle transitions.
 * Proto mappings are not needed (lifecycle is internal, not exposed via gRPC).
 */
import { setup } from "xstate";

export type CoordinatorLifecycleEvent =
  | { type: "CREATE" }
  | { type: "INITIALIZE" }
  | { type: "RUN" }
  | { type: "SHUT_DOWN" }
  | { type: "STOP" };

export type CoordinatorLifecycle = "created" | "initializing" | "running" | "shuttingDown" | "stopped";

export const ALL_COORDINATOR_LIFECYCLES: CoordinatorLifecycle[] = [
  "created", "initializing", "running", "shuttingDown", "stopped",
];

export const coordinatorLifecycleMachine = setup({
  types: {
    events: {} as CoordinatorLifecycleEvent,
  },
}).createMachine({
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
