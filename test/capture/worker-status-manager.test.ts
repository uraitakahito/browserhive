import { describe, it, expect } from "vitest";
import { WorkerStatusManager } from "../../src/capture/worker-status-manager.js";

describe("WorkerStatusManager", () => {
  describe("constructor", () => {
    it("should initialize with stopped status by default", () => {
      const manager = new WorkerStatusManager();
      expect(manager.current).toBe("stopped");
    });

    it("should accept custom initial status", () => {
      const manager = new WorkerStatusManager("ready");
      expect(manager.current).toBe("ready");
    });
  });

  describe("transitionTo", () => {
    it("should allow valid transitions", () => {
      const manager = new WorkerStatusManager("ready");
      manager.transitionTo("busy");
      expect(manager.current).toBe("busy");
    });

    it("should silently ignore invalid transitions", () => {
      const manager = new WorkerStatusManager("stopped");
      manager.transitionTo("busy");
      expect(manager.current).toBe("stopped");
    });

    it("should silently ignore same-state transition", () => {
      const manager = new WorkerStatusManager("ready");
      manager.transitionTo("ready");
      expect(manager.current).toBe("ready");
    });
  });

  describe("convenience methods", () => {
    it("toReady should transition to ready", () => {
      const manager = new WorkerStatusManager("busy");
      manager.toReady();
      expect(manager.current).toBe("ready");
    });

    it("toBusy should transition to busy", () => {
      const manager = new WorkerStatusManager("ready");
      manager.toBusy();
      expect(manager.current).toBe("busy");
    });

    it("toError should transition to error", () => {
      const manager = new WorkerStatusManager("ready");
      manager.toError();
      expect(manager.current).toBe("error");
    });

    it("toStopped should transition to stopped", () => {
      const manager = new WorkerStatusManager("ready");
      manager.toStopped();
      expect(manager.current).toBe("stopped");
    });
  });

  describe("canTransitionTo", () => {
    describe("from ready", () => {
      it("should allow transitions to busy, error, stopped", () => {
        const manager = new WorkerStatusManager("ready");
        expect(manager.canTransitionTo("busy")).toBe(true);
        expect(manager.canTransitionTo("error")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        const manager = new WorkerStatusManager("ready");
        expect(manager.canTransitionTo("ready")).toBe(false);
      });
    });

    describe("from busy", () => {
      it("should allow transitions to ready, error, stopped", () => {
        const manager = new WorkerStatusManager("busy");
        expect(manager.canTransitionTo("ready")).toBe(true);
        expect(manager.canTransitionTo("error")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        const manager = new WorkerStatusManager("busy");
        expect(manager.canTransitionTo("busy")).toBe(false);
      });
    });

    describe("from error", () => {
      it("should allow transitions to ready and stopped", () => {
        const manager = new WorkerStatusManager("error");
        expect(manager.canTransitionTo("ready")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
      });

      it("should not allow transitions to busy or itself", () => {
        const manager = new WorkerStatusManager("error");
        expect(manager.canTransitionTo("busy")).toBe(false);
        expect(manager.canTransitionTo("error")).toBe(false);
      });
    });

    describe("from stopped", () => {
      it("should allow transitions to ready and error", () => {
        const manager = new WorkerStatusManager("stopped");
        expect(manager.canTransitionTo("ready")).toBe(true);
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
    it("should return true for ready", () => {
      const manager = new WorkerStatusManager("ready");
      expect(manager.canProcess).toBe(true);
    });

    it("should return false for non-ready states", () => {
      expect(new WorkerStatusManager("busy").canProcess).toBe(false);
      expect(new WorkerStatusManager("error").canProcess).toBe(false);
      expect(new WorkerStatusManager("stopped").canProcess).toBe(false);
    });
  });

  describe("isHealthy", () => {
    it("should return true for ready and busy", () => {
      expect(new WorkerStatusManager("ready").isHealthy).toBe(true);
      expect(new WorkerStatusManager("busy").isHealthy).toBe(true);
    });

    it("should return false for error and stopped", () => {
      expect(new WorkerStatusManager("error").isHealthy).toBe(false);
      expect(new WorkerStatusManager("stopped").isHealthy).toBe(false);
    });
  });
});
