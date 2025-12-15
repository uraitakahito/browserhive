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

    it("should allow same-state transition (idempotent)", () => {
      const manager = new WorkerStatusManager("idle");
      expect(() => {
        manager.transitionTo("idle");
      }).not.toThrow();
      expect(manager.current).toBe("idle");
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
