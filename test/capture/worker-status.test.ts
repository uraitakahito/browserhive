import { describe, it, expect } from "vitest";
import {
  WORKER_STATUS_DEFINITIONS,
  canProcess,
  isHealthyStatus,
  canTransitionTo,
  ALL_WORKER_STATUSES,
} from "../../src/capture/worker-status.js";
import type { WorkerStatus } from "../../src/capture/worker-status.js";

describe("worker-status", () => {
  describe("WORKER_STATUS_DEFINITIONS", () => {
    it("should define all WorkerStatus values", () => {
      const expectedStatuses: WorkerStatus[] = [
        "idle",
        "busy",
        "error",
        "stopped",
      ];
      for (const status of expectedStatuses) {
        expect(WORKER_STATUS_DEFINITIONS).toHaveProperty(status);
      }
    });

    it("should have consistent structure for all states", () => {
      for (const config of Object.values(WORKER_STATUS_DEFINITIONS)) {
        expect(config).toHaveProperty("canProcess");
        expect(config).toHaveProperty("healthy");
        expect(config).toHaveProperty("allowedTransitions");
        expect(typeof config.canProcess).toBe("boolean");
        expect(typeof config.healthy).toBe("boolean");
        expect(Array.isArray(config.allowedTransitions)).toBe(true);
      }
    });
  });

  describe("ALL_WORKER_STATUSES", () => {
    it("should contain all worker statuses", () => {
      expect(ALL_WORKER_STATUSES).toContain("idle");
      expect(ALL_WORKER_STATUSES).toContain("busy");
      expect(ALL_WORKER_STATUSES).toContain("error");
      expect(ALL_WORKER_STATUSES).toContain("stopped");
      expect(ALL_WORKER_STATUSES).toHaveLength(4);
    });
  });

  describe("canProcess", () => {
    it("should return true only for idle", () => {
      expect(canProcess("idle")).toBe(true);
      expect(canProcess("busy")).toBe(false);
      expect(canProcess("error")).toBe(false);
      expect(canProcess("stopped")).toBe(false);
    });
  });

  describe("isHealthyStatus", () => {
    it("should return true for idle and busy", () => {
      expect(isHealthyStatus("idle")).toBe(true);
      expect(isHealthyStatus("busy")).toBe(true);
    });

    it("should return false for error and stopped", () => {
      expect(isHealthyStatus("error")).toBe(false);
      expect(isHealthyStatus("stopped")).toBe(false);
    });
  });

  describe("canTransitionTo", () => {
    describe("from idle", () => {
      it("should allow transitions to busy, error, stopped", () => {
        expect(canTransitionTo("idle", "busy")).toBe(true);
        expect(canTransitionTo("idle", "error")).toBe(true);
        expect(canTransitionTo("idle", "stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        expect(canTransitionTo("idle", "idle")).toBe(false);
      });
    });

    describe("from busy", () => {
      it("should allow transitions to idle, error, stopped", () => {
        expect(canTransitionTo("busy", "idle")).toBe(true);
        expect(canTransitionTo("busy", "error")).toBe(true);
        expect(canTransitionTo("busy", "stopped")).toBe(true);
      });

      it("should not allow transition to itself", () => {
        expect(canTransitionTo("busy", "busy")).toBe(false);
      });
    });

    describe("from error", () => {
      it("should allow transitions to idle and stopped", () => {
        expect(canTransitionTo("error", "idle")).toBe(true);
        expect(canTransitionTo("error", "stopped")).toBe(true);
      });

      it("should not allow transitions to busy or itself", () => {
        expect(canTransitionTo("error", "busy")).toBe(false);
        expect(canTransitionTo("error", "error")).toBe(false);
      });
    });

    describe("from stopped", () => {
      it("should allow transitions to idle and error", () => {
        expect(canTransitionTo("stopped", "idle")).toBe(true);
        expect(canTransitionTo("stopped", "error")).toBe(true);
      });

      it("should not allow transitions to busy or itself", () => {
        expect(canTransitionTo("stopped", "busy")).toBe(false);
        expect(canTransitionTo("stopped", "stopped")).toBe(false);
      });
    });
  });
});
