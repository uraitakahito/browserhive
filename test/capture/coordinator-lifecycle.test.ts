import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import {
  ALL_COORDINATOR_LIFECYCLES,
  coordinatorLifecycleMachine,
} from "../../src/capture/coordinator-lifecycle.js";
import type { CoordinatorLifecycle } from "../../src/capture/coordinator-lifecycle.js";

/** Create an actor starting at the given state */
const actorAt = (state: CoordinatorLifecycle) => {
  const actor = createActor(coordinatorLifecycleMachine, {
    snapshot: coordinatorLifecycleMachine.resolveState({ value: state, context: {} }),
  });
  actor.start();
  return actor;
};

describe("coordinator-lifecycle", () => {
  describe("ALL_COORDINATOR_LIFECYCLES", () => {
    it("should contain all lifecycle states", () => {
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("created");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("initializing");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("running");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("shuttingDown");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("stopped");
      expect(ALL_COORDINATOR_LIFECYCLES).toHaveLength(5);
    });
  });

  describe("coordinatorLifecycleMachine", () => {
    it("should have created as initial state", () => {
      const actor = createActor(coordinatorLifecycleMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe("created");
    });

    it("should only allow forward transitions in the lifecycle", () => {
      const created = actorAt("created").getSnapshot();
      expect(created.can({ type: "INITIALIZE" })).toBe(true);
      expect(created.can({ type: "RUN" })).toBe(false);
      expect(created.can({ type: "SHUT_DOWN" })).toBe(false);
      expect(created.can({ type: "STOP" })).toBe(false);

      const initializing = actorAt("initializing").getSnapshot();
      expect(initializing.can({ type: "RUN" })).toBe(true);
      expect(initializing.can({ type: "STOP" })).toBe(true);
      expect(initializing.can({ type: "INITIALIZE" })).toBe(false);
      expect(initializing.can({ type: "SHUT_DOWN" })).toBe(false);

      const running = actorAt("running").getSnapshot();
      expect(running.can({ type: "SHUT_DOWN" })).toBe(true);
      expect(running.can({ type: "INITIALIZE" })).toBe(false);
      expect(running.can({ type: "RUN" })).toBe(false);
      expect(running.can({ type: "STOP" })).toBe(false);

      const shuttingDown = actorAt("shuttingDown").getSnapshot();
      expect(shuttingDown.can({ type: "STOP" })).toBe(true);
      expect(shuttingDown.can({ type: "INITIALIZE" })).toBe(false);
      expect(shuttingDown.can({ type: "RUN" })).toBe(false);
      expect(shuttingDown.can({ type: "SHUT_DOWN" })).toBe(false);
    });

    it("stopped should be a final state (no transitions allowed)", () => {
      const stopped = actorAt("stopped").getSnapshot();
      expect(stopped.can({ type: "CREATE" })).toBe(false);
      expect(stopped.can({ type: "INITIALIZE" })).toBe(false);
      expect(stopped.can({ type: "RUN" })).toBe(false);
      expect(stopped.can({ type: "SHUT_DOWN" })).toBe(false);
      expect(stopped.can({ type: "STOP" })).toBe(false);
    });

    describe("tags", () => {
      it("running should have running tag", () => {
        const snapshot = actorAt("running").getSnapshot();
        expect(snapshot.hasTag("running")).toBe(true);
      });

      it("non-running states should not have running tag", () => {
        const states: CoordinatorLifecycle[] = ["created", "initializing", "shuttingDown", "stopped"];
        for (const state of states) {
          const snapshot = actorAt(state).getSnapshot();
          expect(snapshot.hasTag("running")).toBe(false);
        }
      });
    });
  });
});
