import { describe, it, expect } from "vitest";
import { WorkerStatusManager } from "../../src/capture/worker-status-manager.js";

describe("WorkerStatusManager", () => {
  describe("constructor", () => {
    it("should initialize with stopped status by default", () => {
      const manager = new WorkerStatusManager();
      expect(manager.current).toBe("stopped");
    });

    it("should accept custom initial status", () => {
      const manager = new WorkerStatusManager("idle");
      expect(manager.current).toBe("idle");
    });
  });

  describe("transitionTo", () => {
    it("should allow valid transitions", () => {
      const manager = new WorkerStatusManager("idle");
      manager.transitionTo("busy");
      expect(manager.current).toBe("busy");
    });

    it("should throw on invalid transitions", () => {
      const manager = new WorkerStatusManager("stopped");
      expect(() => {
        manager.transitionTo("busy");
      }).toThrow("Invalid status transition: stopped -> busy");
    });

    it("should throw on same-state transition", () => {
      const manager = new WorkerStatusManager("idle");
      expect(() => {
        manager.transitionTo("idle");
      }).toThrow("Invalid status transition: idle -> idle");
    });
  });

  describe("convenience methods", () => {
    it("toIdle should transition to idle", () => {
      const manager = new WorkerStatusManager("busy");
      manager.toIdle();
      expect(manager.current).toBe("idle");
    });

    it("toBusy should transition to busy", () => {
      const manager = new WorkerStatusManager("idle");
      manager.toBusy();
      expect(manager.current).toBe("busy");
    });

    it("toError should transition to error", () => {
      const manager = new WorkerStatusManager("idle");
      manager.toError();
      expect(manager.current).toBe("error");
    });

    it("toStopped should transition to stopped", () => {
      const manager = new WorkerStatusManager("idle");
      manager.toStopped();
      expect(manager.current).toBe("stopped");
    });
  });

  describe("canTransitionTo", () => {
    describe("from idle", () => {
      it("should allow transitions to busy, error, stopped", () => {
        const manager = new WorkerStatusManager("idle");
        expect(manager.canTransitionTo("busy")).toBe(true);
        expect(manager.canTransitionTo("error")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        const manager = new WorkerStatusManager("idle");
        expect(manager.canTransitionTo("idle")).toBe(false);
      });
    });

    describe("from busy", () => {
      it("should allow transitions to idle, error, stopped", () => {
        const manager = new WorkerStatusManager("busy");
        expect(manager.canTransitionTo("idle")).toBe(true);
        expect(manager.canTransitionTo("error")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        const manager = new WorkerStatusManager("busy");
        expect(manager.canTransitionTo("busy")).toBe(false);
      });
    });

    describe("from error", () => {
      it("should allow transitions to idle and stopped", () => {
        const manager = new WorkerStatusManager("error");
        expect(manager.canTransitionTo("idle")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transitions to busy or itself", () => {
        const manager = new WorkerStatusManager("error");
        expect(manager.canTransitionTo("busy")).toBe(false);
        expect(manager.canTransitionTo("error")).toBe(false);
      });
    });

    describe("from stopped", () => {
      it("should allow transitions to idle and error", () => {
        const manager = new WorkerStatusManager("stopped");
        expect(manager.canTransitionTo("idle")).toBe(true);
        expect(manager.canTransitionTo("error")).toBe(true);
      });

      it("should not allow transitions to busy or itself", () => {
        const manager = new WorkerStatusManager("stopped");
        expect(manager.canTransitionTo("busy")).toBe(false);
        expect(manager.canTransitionTo("stopped")).toBe(false);
      });
    });
  });

  describe("canProcess", () => {
    it("should return true for idle", () => {
      const manager = new WorkerStatusManager("idle");
      expect(manager.canProcess).toBe(true);
    });

    it("should return false for non-idle states", () => {
      expect(new WorkerStatusManager("busy").canProcess).toBe(false);
      expect(new WorkerStatusManager("error").canProcess).toBe(false);
      expect(new WorkerStatusManager("stopped").canProcess).toBe(false);
    });
  });

  describe("isHealthy", () => {
    it("should return true for idle and busy", () => {
      expect(new WorkerStatusManager("idle").isHealthy).toBe(true);
      expect(new WorkerStatusManager("busy").isHealthy).toBe(true);
    });

    it("should return false for error and stopped", () => {
      expect(new WorkerStatusManager("error").isHealthy).toBe(false);
      expect(new WorkerStatusManager("stopped").isHealthy).toBe(false);
    });
  });
});
