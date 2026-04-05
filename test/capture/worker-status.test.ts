import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import {
  ALL_WORKER_STATUSES,
  workerStatusMachine,
} from "../../src/capture/worker-status.js";
import type { WorkerStatus } from "../../src/capture/worker-status.js";

/** Create an actor starting at the given state */
const actorAt = (state: WorkerStatus) => {
  const actor = createActor(workerStatusMachine, {
    snapshot: workerStatusMachine.resolveState({ value: state, context: {} }),
  });
  actor.start();
  return actor;
};

describe("worker-status", () => {
  describe("ALL_WORKER_STATUSES", () => {
    it("should contain all worker statuses", () => {
      expect(ALL_WORKER_STATUSES).toContain("ready");
      expect(ALL_WORKER_STATUSES).toContain("busy");
      expect(ALL_WORKER_STATUSES).toContain("error");
      expect(ALL_WORKER_STATUSES).toContain("stopped");
      expect(ALL_WORKER_STATUSES).toHaveLength(4);
    });
  });

  describe("workerStatusMachine", () => {
    it("should have stopped as initial state", () => {
      const actor = createActor(workerStatusMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe("stopped");
    });

    describe("transitions from ready", () => {
      it("should allow TO_BUSY, TO_ERROR, TO_STOPPED", () => {
        const snapshot = actorAt("ready").getSnapshot();
        expect(snapshot.can({ type: "TO_BUSY" })).toBe(true);
        expect(snapshot.can({ type: "TO_ERROR" })).toBe(true);
        expect(snapshot.can({ type: "TO_STOPPED" })).toBe(true);
      });

      it("should not allow TO_READY (self-transition)", () => {
        const snapshot = actorAt("ready").getSnapshot();
        expect(snapshot.can({ type: "TO_READY" })).toBe(false);
      });
    });

    describe("transitions from busy", () => {
      it("should allow TO_READY, TO_ERROR, TO_STOPPED", () => {
        const snapshot = actorAt("busy").getSnapshot();
        expect(snapshot.can({ type: "TO_READY" })).toBe(true);
        expect(snapshot.can({ type: "TO_ERROR" })).toBe(true);
        expect(snapshot.can({ type: "TO_STOPPED" })).toBe(true);
      });

      it("should not allow TO_BUSY (self-transition)", () => {
        const snapshot = actorAt("busy").getSnapshot();
        expect(snapshot.can({ type: "TO_BUSY" })).toBe(false);
      });
    });

    describe("transitions from error", () => {
      it("should allow TO_READY, TO_STOPPED", () => {
        const snapshot = actorAt("error").getSnapshot();
        expect(snapshot.can({ type: "TO_READY" })).toBe(true);
        expect(snapshot.can({ type: "TO_STOPPED" })).toBe(true);
      });

      it("should not allow TO_BUSY or TO_ERROR", () => {
        const snapshot = actorAt("error").getSnapshot();
        expect(snapshot.can({ type: "TO_BUSY" })).toBe(false);
        expect(snapshot.can({ type: "TO_ERROR" })).toBe(false);
      });
    });

    describe("transitions from stopped", () => {
      it("should allow TO_READY, TO_ERROR", () => {
        const snapshot = actorAt("stopped").getSnapshot();
        expect(snapshot.can({ type: "TO_READY" })).toBe(true);
        expect(snapshot.can({ type: "TO_ERROR" })).toBe(true);
      });

      it("should not allow TO_BUSY or TO_STOPPED", () => {
        const snapshot = actorAt("stopped").getSnapshot();
        expect(snapshot.can({ type: "TO_BUSY" })).toBe(false);
        expect(snapshot.can({ type: "TO_STOPPED" })).toBe(false);
      });
    });

    describe("tags", () => {
      it("ready should have canProcess and healthy tags", () => {
        const snapshot = actorAt("ready").getSnapshot();
        expect(snapshot.hasTag("canProcess")).toBe(true);
        expect(snapshot.hasTag("healthy")).toBe(true);
      });

      it("busy should have healthy tag only", () => {
        const snapshot = actorAt("busy").getSnapshot();
        expect(snapshot.hasTag("canProcess")).toBe(false);
        expect(snapshot.hasTag("healthy")).toBe(true);
      });

      it("error should have no tags", () => {
        const snapshot = actorAt("error").getSnapshot();
        expect(snapshot.hasTag("canProcess")).toBe(false);
        expect(snapshot.hasTag("healthy")).toBe(false);
      });

      it("stopped should have no tags", () => {
        const snapshot = actorAt("stopped").getSnapshot();
        expect(snapshot.hasTag("canProcess")).toBe(false);
        expect(snapshot.hasTag("healthy")).toBe(false);
      });
    });
  });
});
