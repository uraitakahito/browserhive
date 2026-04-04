import { describe, it, expect } from "vitest";
import {
  COORDINATOR_LIFECYCLE_DEFINITIONS,
  ALL_COORDINATOR_LIFECYCLES,
} from "../../src/capture/coordinator-lifecycle.js";
import type { CoordinatorLifecycle } from "../../src/capture/coordinator-lifecycle.js";

describe("coordinator-lifecycle", () => {
  describe("COORDINATOR_LIFECYCLE_DEFINITIONS", () => {
    it("should define all CoordinatorLifecycle values", () => {
      const expectedStates: CoordinatorLifecycle[] = [
        "created",
        "initializing",
        "running",
        "shuttingDown",
        "stopped",
      ];
      for (const state of expectedStates) {
        expect(COORDINATOR_LIFECYCLE_DEFINITIONS).toHaveProperty(state);
      }
    });

    it("should have consistent structure for all states", () => {
      for (const config of Object.values(COORDINATOR_LIFECYCLE_DEFINITIONS)) {
        expect(config).toHaveProperty("allowedTransitions");
        expect(Array.isArray(config.allowedTransitions)).toBe(true);
      }
    });

    it("should only allow forward transitions in the lifecycle", () => {
      expect(COORDINATOR_LIFECYCLE_DEFINITIONS.created.allowedTransitions).toEqual(["initializing"]);
      expect(COORDINATOR_LIFECYCLE_DEFINITIONS.initializing.allowedTransitions).toEqual(["running", "stopped"]);
      expect(COORDINATOR_LIFECYCLE_DEFINITIONS.running.allowedTransitions).toEqual(["shuttingDown"]);
      expect(COORDINATOR_LIFECYCLE_DEFINITIONS.shuttingDown.allowedTransitions).toEqual(["stopped"]);
      expect(COORDINATOR_LIFECYCLE_DEFINITIONS.stopped.allowedTransitions).toEqual([]);
    });
  });

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
});
