import { describe, it, expect, vi } from "vitest";
import { createActor, fromPromise, type AnyActorLogic } from "xstate";
import {
  coordinatorMachine,
  ALL_COORDINATOR_LIFECYCLES,
} from "../../src/capture/coordinator-machine.js";
import type { CoordinatorLifecycle } from "../../src/capture/coordinator-machine.js";
import type { WorkerInitFailure } from "../../src/capture/coordinator-errors.js";
import { TaskQueue } from "../../src/capture/task-queue.js";
import { ok, err, type Result } from "../../src/result.js";
import { createTestCoordinatorConfig } from "../helpers/config.js";

const createTestInput = () => ({ config: createTestCoordinatorConfig() });

const createTestContext = () => ({
  config: createTestCoordinatorConfig(),
  taskQueue: new TaskQueue(),
  workers: [],
});

/** Promise actor stub that hangs forever, holding its enclosing state */
const hangingPromise = fromPromise<undefined>(
  () => new Promise<undefined>(() => { /* never resolves */ }),
);

interface ActorOverrides {
  initializeWorkers?: AnyActorLogic;
  shutdownWorkers?: AnyActorLogic;
}

/** Provide variant of the machine with invoked actors overridden by stubs */
const machineWith = (overrides: ActorOverrides = {}) =>
  coordinatorMachine.provide({
    actors: {
      initializeWorkers: (overrides.initializeWorkers ?? hangingPromise) as never,
      shutdownWorkers: (overrides.shutdownWorkers ?? hangingPromise) as never,
    },
  });

/**
 * Create an actor starting at the given state. States with an `invoke`
 * (initializing, shuttingDown) get hanging stubs so the machine stays put.
 */
const actorAt = (state: CoordinatorLifecycle) => {
  const machine = machineWith();
  const actor = createActor(machine, {
    input: createTestInput(),
    snapshot: machine.resolveState({
      value: state,
      context: createTestContext(),
    }),
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
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("terminated");
      expect(ALL_COORDINATOR_LIFECYCLES).toHaveLength(5);
    });
  });

  describe("coordinatorMachine", () => {
    it("should have created as initial state", () => {
      const actor = createActor(coordinatorMachine, { input: createTestInput() });
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

      it("initializing → running when initializeWorkers returns ok", async () => {
        const machine = machineWith({
          initializeWorkers: fromPromise<Result<undefined, WorkerInitFailure>>(() =>
            Promise.resolve(ok(undefined)),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("running");
        });
      });

      it("initializing → terminated when initializeWorkers returns err", async () => {
        const failure: WorkerInitFailure = { kind: "no-profiles" };
        const machine = machineWith({
          initializeWorkers: fromPromise<Result<undefined, WorkerInitFailure>>(() =>
            Promise.resolve(err(failure)),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("terminated");
        });
      });

      it("records the WorkerInitFailure into context.lastInitFailure on terminated", async () => {
        const failure: WorkerInitFailure = {
          kind: "partial-failure",
          operational: 1,
          total: 2,
          failed: [
            {
              browserURL: "http://b:9222",
              reason: { type: "connection", message: "boom" },
            },
          ],
        };
        const machine = machineWith({
          initializeWorkers: fromPromise<Result<undefined, WorkerInitFailure>>(() =>
            Promise.resolve(err(failure)),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("terminated");
        });
        expect(actor.getSnapshot().context.lastInitFailure).toEqual(failure);
      });

      it("running → shuttingDown via SHUTDOWN", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "SHUTDOWN" })).toBe(true);
        actor.send({ type: "SHUTDOWN" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("running → shuttingDown via ALL_WORKERS_ERROR", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "ALL_WORKERS_ERROR" })).toBe(true);
        actor.send({ type: "ALL_WORKERS_ERROR" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("shuttingDown → terminated when shutdownWorkers resolves", async () => {
        const machine = machineWith({
          shutdownWorkers: fromPromise<undefined>(() => Promise.resolve(undefined)),
        });
        // Start in `running` (snapshot doesn't re-trigger invokes), then drive
        // through SHUTDOWN so the entry into `shuttingDown` actually invokes
        // shutdownWorkers.
        const actor = createActor(machine, {
          input: createTestInput(),
          snapshot: machine.resolveState({
            value: "running",
            context: createTestContext(),
          }),
        });
        actor.start();
        actor.send({ type: "SHUTDOWN" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("terminated");
        });
      });
    });

    describe("invalid transitions", () => {
      it("created should not allow SHUTDOWN", () => {
        const snapshot = actorAt("created").getSnapshot();
        expect(snapshot.can({ type: "SHUTDOWN" })).toBe(false);
      });

      it("initializing should not allow INITIALIZE, SHUTDOWN", () => {
        const snapshot = actorAt("initializing").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
        expect(snapshot.can({ type: "SHUTDOWN" })).toBe(false);
      });

      it("running should not allow INITIALIZE", () => {
        const snapshot = actorAt("running").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
      });

      it("terminated should be a final state (no transitions allowed)", () => {
        const snapshot = actorAt("terminated").getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
        expect(snapshot.can({ type: "SHUTDOWN" })).toBe(false);
      });
    });

  });
});
