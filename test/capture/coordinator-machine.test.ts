import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import {
  coordinatorMachine,
  ALL_COORDINATOR_LIFECYCLES,
} from "../../src/capture/coordinator-machine.js";
import type { CoordinatorLifecycle } from "../../src/capture/coordinator-machine.js";

/** Create an actor starting at the given state */
const actorAt = (state: CoordinatorLifecycle) => {
  const actor = createActor(coordinatorMachine, {
    snapshot: coordinatorMachine.resolveState({ value: state, context: {} }),
  });
  actor.start();
  return actor;
};

describe("coordinator-machine", () => {
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

  describe("coordinatorMachine", () => {
    it("should have created as initial state", () => {
      const actor = createActor(coordinatorMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe("created");
    });

    describe("lifecycle transitions", () => {
      it("created → initializing via INITIALIZE", () => {
        const actor = actorAt("created");
        expect(actor.getSnapshot().can({ type: "INITIALIZE" })).toBe(true);
        actor.send({ type: "INITIALIZE" });
        expect(actor.getSnapshot().value).toBe("initializing");
      });

      it("initializing → running via INIT_DONE", () => {
        const actor = actorAt("initializing");
        expect(actor.getSnapshot().can({ type: "INIT_DONE" })).toBe(true);
        actor.send({ type: "INIT_DONE" });
        expect(actor.getSnapshot().value).toBe("running");
      });

      it("initializing → stopped via INIT_FAILED", () => {
        const actor = actorAt("initializing");
        expect(actor.getSnapshot().can({ type: "INIT_FAILED" })).toBe(true);
        actor.send({ type: "INIT_FAILED" });
        expect(actor.getSnapshot().value).toBe("stopped");
      });

      it("running → shuttingDown via SHUT_DOWN", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "SHUT_DOWN" })).toBe(true);
        actor.send({ type: "SHUT_DOWN" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("running → shuttingDown via ALL_WORKERS_ERROR", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "ALL_WORKERS_ERROR" })).toBe(true);
        actor.send({ type: "ALL_WORKERS_ERROR" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("shuttingDown → stopped via SHUTDOWN_DONE", () => {
        const actor = actorAt("shuttingDown");
        expect(actor.getSnapshot().can({ type: "SHUTDOWN_DONE" })).toBe(true);
        actor.send({ type: "SHUTDOWN_DONE" });
        expect(actor.getSnapshot().value).toBe("stopped");
      });
    });

    describe("invalid transitions", () => {
      it("created should not allow SHUT_DOWN, INIT_DONE, INIT_FAILED", () => {
        const snapshot = actorAt("created").getSnapshot();
        expect(snapshot.can({ type: "SHUT_DOWN" })).toBe(false);
        expect(snapshot.can({ type: "INIT_DONE" })).toBe(false);
        expect(snapshot.can({ type: "INIT_FAILED" })).toBe(false);
      });

      it("initializing should not allow INITIALIZE, SHUT_DOWN", () => {
        const snapshot = actorAt("initializing").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
        expect(snapshot.can({ type: "SHUT_DOWN" })).toBe(false);
      });

      it("running should not allow INITIALIZE, INIT_DONE", () => {
        const snapshot = actorAt("running").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
        expect(snapshot.can({ type: "INIT_DONE" })).toBe(false);
      });

      it("stopped should be a final state (no transitions allowed)", () => {
        const snapshot = actorAt("stopped").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
        expect(snapshot.can({ type: "SHUT_DOWN" })).toBe(false);
        expect(snapshot.can({ type: "SHUTDOWN_DONE" })).toBe(false);
      });
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
