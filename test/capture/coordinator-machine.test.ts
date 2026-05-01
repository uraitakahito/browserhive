import { describe, it, expect, vi } from "vitest";
import { createActor, fromCallback, fromPromise, type AnyActorLogic } from "xstate";
import {
  coordinatorMachine,
  ALL_COORDINATOR_LIFECYCLES,
} from "../../src/capture/coordinator-machine.js";
import type { CoordinatorLifecycle } from "../../src/capture/coordinator-machine.js";
import type {
  InitializeWorkersOutput,
} from "../../src/capture/coordinator-actors.js";
import type {
  ShutdownFailure,
} from "../../src/capture/coordinator-errors.js";
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
  watchWorkerHealth?: AnyActorLogic;
  retryFailedWorkers?: AnyActorLogic;
}

/** No-op fromCallback used to satisfy `running`/`degraded` invokes in tests */
const noopCallback = fromCallback(() => {
  return () => { /* no-op */ };
});

/** Provide variant of the machine with invoked actors overridden by stubs */
const machineWith = (overrides: ActorOverrides = {}) =>
  coordinatorMachine.provide({
    actors: {
      initializeWorkers: (overrides.initializeWorkers ?? hangingPromise) as never,
      shutdownWorkers: (overrides.shutdownWorkers ?? hangingPromise) as never,
      watchWorkerHealth: (overrides.watchWorkerHealth ?? noopCallback) as never,
      retryFailedWorkers: (overrides.retryFailedWorkers ?? noopCallback) as never,
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
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("degraded");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("shuttingDown");
      expect(ALL_COORDINATOR_LIFECYCLES).toContain("terminated");
      expect(ALL_COORDINATOR_LIFECYCLES).toHaveLength(6);
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

      it("initializing → running when initializeWorkers reports allHealthy", async () => {
        const machine = machineWith({
          initializeWorkers: fromPromise<InitializeWorkersOutput>(() =>
            Promise.resolve({ allHealthy: true, failed: [] }),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("running");
        });
      });

      it("initializing → degraded when some workers failed", async () => {
        const summary: InitializeWorkersOutput = {
          allHealthy: false,
          failed: [
            {
              browserURL: "http://b:9222",
              reason: { type: "connection", message: "boom" },
            },
          ],
        };
        const machine = machineWith({
          initializeWorkers: fromPromise<InitializeWorkersOutput>(() =>
            Promise.resolve(summary),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("degraded");
        });
      });

      it("records the InitializeWorkersOutput into context.lastInitSummary on degraded", async () => {
        const summary: InitializeWorkersOutput = {
          allHealthy: false,
          failed: [
            {
              browserURL: "http://b:9222",
              reason: { type: "connection", message: "boom" },
            },
          ],
        };
        const machine = machineWith({
          initializeWorkers: fromPromise<InitializeWorkersOutput>(() =>
            Promise.resolve(summary),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("degraded");
        });
        expect(actor.getSnapshot().context.lastInitSummary).toEqual(summary);
      });

      it("running → degraded via WORKER_DEGRADED", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "WORKER_DEGRADED" })).toBe(true);
        actor.send({ type: "WORKER_DEGRADED" });
        expect(actor.getSnapshot().value).toBe("degraded");
      });

      it("degraded → running via ALL_WORKERS_HEALTHY", () => {
        const actor = actorAt("degraded");
        expect(actor.getSnapshot().can({ type: "ALL_WORKERS_HEALTHY" })).toBe(true);
        actor.send({ type: "ALL_WORKERS_HEALTHY" });
        expect(actor.getSnapshot().value).toBe("running");
      });

      it("running → shuttingDown via SHUTDOWN", () => {
        const actor = actorAt("running");
        expect(actor.getSnapshot().can({ type: "SHUTDOWN" })).toBe(true);
        actor.send({ type: "SHUTDOWN" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("degraded → shuttingDown via SHUTDOWN", () => {
        const actor = actorAt("degraded");
        expect(actor.getSnapshot().can({ type: "SHUTDOWN" })).toBe(true);
        actor.send({ type: "SHUTDOWN" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("shuttingDown → terminated when shutdownWorkers returns ok", async () => {
        const machine = machineWith({
          shutdownWorkers: fromPromise<Result<void, ShutdownFailure>>(() =>
            Promise.resolve(ok()),
          ),
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

      it("shuttingDown → terminated even when shutdownWorkers returns timeout failure", async () => {
        const failure: ShutdownFailure = {
          kind: "timeout",
          timeoutMs: 5000,
          unsettled: ["http://stuck:9222"],
        };
        const machine = machineWith({
          shutdownWorkers: fromPromise<Result<void, ShutdownFailure>>(() =>
            Promise.resolve(err(failure)),
          ),
        });
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

      it("degraded should not allow INITIALIZE", () => {
        const snapshot = actorAt("degraded").getSnapshot();
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
