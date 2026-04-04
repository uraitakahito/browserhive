import { describe, it, expect } from "vitest";
import { CoordinatorLifecycleManager } from "../../src/capture/coordinator-lifecycle-manager.js";

describe("CoordinatorLifecycleManager", () => {
  describe("constructor", () => {
    it("should initialize with created status", () => {
      const manager = new CoordinatorLifecycleManager();
      expect(manager.current).toBe("created");
    });
  });

  describe("transitionTo", () => {
    it("should allow valid transitions", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.transitionTo("initializing");
      expect(manager.current).toBe("initializing");
    });

    it("should throw on invalid transitions", () => {
      const manager = new CoordinatorLifecycleManager();
      expect(() => {
        manager.transitionTo("running");
      }).toThrow("Invalid status transition: created -> running");
    });

    it("should throw on self-transition", () => {
      const manager = new CoordinatorLifecycleManager();
      expect(() => {
        manager.transitionTo("created");
      }).toThrow("Invalid status transition: created -> created");
    });
  });

  describe("convenience methods", () => {
    it("toInitializing should transition to initializing", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      expect(manager.current).toBe("initializing");
    });

    it("toRunning should transition to running", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      expect(manager.current).toBe("running");
    });

    it("toShuttingDown should transition to shuttingDown", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      manager.toShuttingDown();
      expect(manager.current).toBe("shuttingDown");
    });

    it("toStopped should transition to stopped", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      manager.toShuttingDown();
      manager.toStopped();
      expect(manager.current).toBe("stopped");
    });
  });

  describe("canTransitionTo", () => {
    describe("from created", () => {
      it("should allow transition to initializing only", () => {
        const manager = new CoordinatorLifecycleManager();
        expect(manager.canTransitionTo("initializing")).toBe(true);
        expect(manager.canTransitionTo("running")).toBe(false);
        expect(manager.canTransitionTo("shuttingDown")).toBe(false);
        expect(manager.canTransitionTo("stopped")).toBe(false);
        expect(manager.canTransitionTo("created")).toBe(false);
      });
    });

    describe("from initializing", () => {
      it("should allow transition to running and stopped", () => {
        const manager = new CoordinatorLifecycleManager();
        manager.toInitializing();
        expect(manager.canTransitionTo("running")).toBe(true);
        expect(manager.canTransitionTo("stopped")).toBe(true);
        expect(manager.canTransitionTo("created")).toBe(false);
        expect(manager.canTransitionTo("shuttingDown")).toBe(false);
        expect(manager.canTransitionTo("initializing")).toBe(false);
      });
    });

    describe("from running", () => {
      it("should allow transition to shuttingDown only", () => {
        const manager = new CoordinatorLifecycleManager();
        manager.toInitializing();
        manager.toRunning();
        expect(manager.canTransitionTo("shuttingDown")).toBe(true);
        expect(manager.canTransitionTo("created")).toBe(false);
        expect(manager.canTransitionTo("initializing")).toBe(false);
        expect(manager.canTransitionTo("running")).toBe(false);
        expect(manager.canTransitionTo("stopped")).toBe(false);
      });
    });

    describe("from shuttingDown", () => {
      it("should allow transition to stopped only", () => {
        const manager = new CoordinatorLifecycleManager();
        manager.toInitializing();
        manager.toRunning();
        manager.toShuttingDown();
        expect(manager.canTransitionTo("stopped")).toBe(true);
        expect(manager.canTransitionTo("created")).toBe(false);
        expect(manager.canTransitionTo("initializing")).toBe(false);
        expect(manager.canTransitionTo("running")).toBe(false);
        expect(manager.canTransitionTo("shuttingDown")).toBe(false);
      });
    });

    describe("from stopped", () => {
      it("should not allow any transitions", () => {
        const manager = new CoordinatorLifecycleManager();
        manager.toInitializing();
        manager.toRunning();
        manager.toShuttingDown();
        manager.toStopped();
        expect(manager.canTransitionTo("created")).toBe(false);
        expect(manager.canTransitionTo("initializing")).toBe(false);
        expect(manager.canTransitionTo("running")).toBe(false);
        expect(manager.canTransitionTo("shuttingDown")).toBe(false);
        expect(manager.canTransitionTo("stopped")).toBe(false);
      });
    });
  });

  describe("isRunning", () => {
    it("should return false for created", () => {
      const manager = new CoordinatorLifecycleManager();
      expect(manager.isRunning).toBe(false);
    });

    it("should return false for initializing", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      expect(manager.isRunning).toBe(false);
    });

    it("should return true for running", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      expect(manager.isRunning).toBe(true);
    });

    it("should return false for shuttingDown", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      manager.toShuttingDown();
      expect(manager.isRunning).toBe(false);
    });

    it("should return false for stopped", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toRunning();
      manager.toShuttingDown();
      manager.toStopped();
      expect(manager.isRunning).toBe(false);
    });
  });

  describe("full lifecycle", () => {
    it("should complete the full lifecycle: created → initializing → running → shuttingDown → stopped", () => {
      const manager = new CoordinatorLifecycleManager();
      expect(manager.current).toBe("created");

      manager.toInitializing();
      expect(manager.current).toBe("initializing");

      manager.toRunning();
      expect(manager.current).toBe("running");

      manager.toShuttingDown();
      expect(manager.current).toBe("shuttingDown");

      manager.toStopped();
      expect(manager.current).toBe("stopped");
    });

    it("should allow initializing → stopped (initialization failure)", () => {
      const manager = new CoordinatorLifecycleManager();
      manager.toInitializing();
      manager.toStopped();
      expect(manager.current).toBe("stopped");
    });
  });
});
