import { describe, it, expect } from "vitest";
import { StateMachine, type BaseStateDefinition } from "../../src/capture/state-machine.js";

/**
 * Simple 3-state fixture for basic tests
 *
 *   idle → active → done
 *          active → idle (back)
 */
const SIMPLE_DEFINITIONS = {
  idle: { allowedTransitions: ["active"] as const },
  active: { allowedTransitions: ["idle", "done"] as const },
  done: { allowedTransitions: [] as const },
} as const;

type SimpleState = keyof typeof SIMPLE_DEFINITIONS;

/**
 * Worker-compatible fixture to prove StateMachine works with
 * definitions that carry extra properties beyond allowedTransitions
 */
interface WorkerLikeDefinition extends BaseStateDefinition<WorkerLikeState> {
  readonly canProcess: boolean;
  readonly healthy: boolean;
}

const WORKER_LIKE_DEFINITIONS: Record<WorkerLikeState, WorkerLikeDefinition> = {
  ready: {
    canProcess: true,
    healthy: true,
    allowedTransitions: ["busy", "error", "stopped"],
  },
  busy: {
    canProcess: false,
    healthy: true,
    allowedTransitions: ["ready", "error", "stopped"],
  },
  error: {
    canProcess: false,
    healthy: false,
    allowedTransitions: ["ready", "stopped"],
  },
  stopped: {
    canProcess: false,
    healthy: false,
    allowedTransitions: ["ready", "error"],
  },
} as const;

type WorkerLikeState = "ready" | "busy" | "error" | "stopped";

describe("StateMachine", () => {
  describe("constructor", () => {
    it("should initialize with the given initial state", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(sm.current).toBe("idle");
    });

    it("should accept any valid state as initial", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "done");
      expect(sm.current).toBe("done");
    });
  });

  describe("current", () => {
    it("should reflect the current state after transitions", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      sm.transitionTo("active");
      expect(sm.current).toBe("active");
    });
  });

  describe("transitionTo", () => {
    it("should transition to a valid next state", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      sm.transitionTo("active");
      expect(sm.current).toBe("active");
    });

    it("should allow multiple sequential transitions", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      sm.transitionTo("active");
      sm.transitionTo("done");
      expect(sm.current).toBe("done");
    });

    it("should allow transitioning back to a previous state", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      sm.transitionTo("active");
      sm.transitionTo("idle");
      expect(sm.current).toBe("idle");
    });

    it("should throw on invalid transition", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(() => { sm.transitionTo("done"); }).toThrow(
        "Invalid status transition: idle -> done"
      );
    });

    it("should throw on self-transition when not allowed", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(() => { sm.transitionTo("idle"); }).toThrow(
        "Invalid status transition: idle -> idle"
      );
    });

    it("should throw when transitioning from a terminal state", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "done");
      expect(() => { sm.transitionTo("idle"); }).toThrow(
        "Invalid status transition: done -> idle"
      );
    });
  });

  describe("canTransitionTo", () => {
    it("should return true for valid transitions", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(sm.canTransitionTo("active")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(sm.canTransitionTo("done")).toBe(false);
    });

    it("should return false for self-transition when not allowed", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "idle");
      expect(sm.canTransitionTo("idle")).toBe(false);
    });

    it("should return false for all transitions from terminal state", () => {
      const sm = new StateMachine<SimpleState>(SIMPLE_DEFINITIONS, "done");
      expect(sm.canTransitionTo("idle")).toBe(false);
      expect(sm.canTransitionTo("active")).toBe(false);
      expect(sm.canTransitionTo("done")).toBe(false);
    });
  });

  describe("with worker-like definitions (extra properties)", () => {
    it("should work with definitions that extend BaseStateDefinition", () => {
      const sm = new StateMachine<WorkerLikeState>(WORKER_LIKE_DEFINITIONS, "stopped");
      sm.transitionTo("ready");
      expect(sm.current).toBe("ready");
    });

    it("should enforce transition rules from extended definitions", () => {
      const sm = new StateMachine<WorkerLikeState>(WORKER_LIKE_DEFINITIONS, "stopped");
      expect(sm.canTransitionTo("ready")).toBe(true);
      expect(sm.canTransitionTo("error")).toBe(true);
      expect(sm.canTransitionTo("busy")).toBe(false);
      expect(sm.canTransitionTo("stopped")).toBe(false);
    });

    it("should follow the full worker lifecycle", () => {
      const sm = new StateMachine<WorkerLikeState>(WORKER_LIKE_DEFINITIONS, "stopped");
      sm.transitionTo("ready");
      sm.transitionTo("busy");
      sm.transitionTo("ready");
      sm.transitionTo("stopped");
      expect(sm.current).toBe("stopped");
    });

    it("should allow extra properties to be accessed from definitions", () => {
      expect(WORKER_LIKE_DEFINITIONS.ready.canProcess).toBe(true);
      expect(WORKER_LIKE_DEFINITIONS.ready.healthy).toBe(true);
      expect(WORKER_LIKE_DEFINITIONS.busy.canProcess).toBe(false);
      expect(WORKER_LIKE_DEFINITIONS.error.healthy).toBe(false);
    });
  });
});
