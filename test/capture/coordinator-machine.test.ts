import { describe, it, expect, vi } from "vitest";
import { createActor, fromCallback, fromPromise, type AnyActorLogic } from "xstate";
import {
  coordinatorMachine,
  ALL_COORDINATOR_LIFECYCLES,
} from "../../src/capture/coordinator-machine.js";

/**
 * State value shape accepted by `machine.resolveState({ value })` for the
 * coordinator. Top-level atomic states are bare strings; the compound
 * `active` state is expressed as an object naming the desired substate.
 */
type LifecycleStateValue =
  | "created"
  | "initializing"
  | "shuttingDown"
  | "terminated"
  | { active: "running" | "degraded" };
import type {
  InitializeWorkersOutput,
} from "../../src/capture/coordinator-actors.js";
import type {
  ShutdownFailure,
} from "../../src/capture/coordinator-errors.js";
import { TaskQueue } from "../../src/capture/task-queue.js";
import { ok, err, type Result } from "../../src/result.js";
import {
  createTestArtifactStore,
  createTestCoordinatorConfig,
} from "../helpers/config.js";

const createTestInput = () => ({
  config: createTestCoordinatorConfig(),
  store: createTestArtifactStore(),
});

const createTestContext = () => ({
  config: createTestCoordinatorConfig(),
  store: createTestArtifactStore(),
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

/** No-op fromCallback used to satisfy `active`/`degraded` invokes in tests */
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
const actorAt = (state: LifecycleStateValue) => {
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
    it("should enumerate the leaf lifecycle states", () => {
      expect(ALL_COORDINATOR_LIFECYCLES).toEqual([
        "created",
        "initializing",
        "active.running",
        "active.degraded",
        "shuttingDown",
        "terminated",
      ]);
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

      it("initializing → active.running when initializeWorkers reports allHealthy", async () => {
        const machine = machineWith({
          initializeWorkers: fromPromise<InitializeWorkersOutput>(() =>
            Promise.resolve({ allHealthy: true, failed: [] }),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().matches({ active: "running" })).toBe(true);
        });
      });

      it("initializing → active.degraded when some workers failed", async () => {
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
          expect(actor.getSnapshot().matches({ active: "degraded" })).toBe(true);
        });
      });

      it("active.running → active.degraded via WORKER_DEGRADED", () => {
        const actor = actorAt({ active: "running" });
        expect(actor.getSnapshot().can({ type: "WORKER_DEGRADED" })).toBe(true);
        actor.send({ type: "WORKER_DEGRADED" });
        expect(actor.getSnapshot().matches({ active: "degraded" })).toBe(true);
      });

      it("active.degraded → active.running via ALL_WORKERS_HEALTHY", () => {
        const actor = actorAt({ active: "degraded" });
        expect(actor.getSnapshot().can({ type: "ALL_WORKERS_HEALTHY" })).toBe(true);
        actor.send({ type: "ALL_WORKERS_HEALTHY" });
        expect(actor.getSnapshot().matches({ active: "running" })).toBe(true);
      });

      it("WORKER_DEGRADED in active.degraded is a no-op (handler lives on substate `running` only)", () => {
        const actor = actorAt({ active: "degraded" });
        expect(actor.getSnapshot().can({ type: "WORKER_DEGRADED" })).toBe(false);
        actor.send({ type: "WORKER_DEGRADED" });
        expect(actor.getSnapshot().matches({ active: "degraded" })).toBe(true);
      });

      it("ALL_WORKERS_HEALTHY in active.running is a no-op (handler lives on substate `degraded` only)", () => {
        const actor = actorAt({ active: "running" });
        expect(actor.getSnapshot().can({ type: "ALL_WORKERS_HEALTHY" })).toBe(false);
        actor.send({ type: "ALL_WORKERS_HEALTHY" });
        expect(actor.getSnapshot().matches({ active: "running" })).toBe(true);
      });

      it("active.running → shuttingDown via SHUTDOWN", () => {
        const actor = actorAt({ active: "running" });
        expect(actor.getSnapshot().can({ type: "SHUTDOWN" })).toBe(true);
        actor.send({ type: "SHUTDOWN" });
        expect(actor.getSnapshot().value).toBe("shuttingDown");
      });

      it("active.degraded → shuttingDown via SHUTDOWN", () => {
        const actor = actorAt({ active: "degraded" });
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
        // Start in `active.running` (snapshot doesn't re-trigger invokes),
        // then drive through SHUTDOWN so the entry into `shuttingDown` actually
        // invokes shutdownWorkers.
        const actor = createActor(machine, {
          input: createTestInput(),
          snapshot: machine.resolveState({
            value: { active: "running" },
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
            value: { active: "running" },
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

    describe("hoisted invoke on `active`", () => {
      // Prior to compounding `active`, watchWorkerHealth was invoked separately
      // from `running` and from `degraded`, so every running ↔ degraded
      // transition tore down and re-created subscriptions. With the invoke
      // hoisted to `active`, the actor must outlive substate flips.
      //
      // Snapshot-restored start does not re-invoke parent actors, so these
      // tests drive the machine through a real INITIALIZE transition to
      // observe the invoke lifecycle.
      const enterActiveRunning = (extra: ActorOverrides = {}) => {
        const machine = machineWith({
          ...extra,
          initializeWorkers: fromPromise<InitializeWorkersOutput>(() =>
            Promise.resolve({ allHealthy: true, failed: [] }),
          ),
        });
        const actor = createActor(machine, { input: createTestInput() });
        actor.start();
        actor.send({ type: "INITIALIZE" });
        return actor;
      };

      it("watchWorkerHealth is invoked once across active.running ↔ active.degraded oscillations", async () => {
        let activeInvocations = 0;
        const countingWatch = fromCallback(() => {
          activeInvocations += 1;
          return () => { /* disposed when leaving `active` */ };
        });

        const actor = enterActiveRunning({ watchWorkerHealth: countingWatch });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().matches({ active: "running" })).toBe(true);
        });
        expect(activeInvocations).toBe(1);

        // Two full oscillations.
        actor.send({ type: "WORKER_DEGRADED" });
        actor.send({ type: "ALL_WORKERS_HEALTHY" });
        actor.send({ type: "WORKER_DEGRADED" });
        actor.send({ type: "ALL_WORKERS_HEALTHY" });

        expect(activeInvocations).toBe(1);
      });

      it("watchWorkerHealth is disposed exactly once on transition to shuttingDown", async () => {
        let invocations = 0;
        let disposals = 0;
        const trackingWatch = fromCallback(() => {
          invocations += 1;
          return () => { disposals += 1; };
        });

        const actor = enterActiveRunning({ watchWorkerHealth: trackingWatch });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().matches({ active: "running" })).toBe(true);
        });

        actor.send({ type: "WORKER_DEGRADED" });
        actor.send({ type: "ALL_WORKERS_HEALTHY" });
        expect(disposals).toBe(0);

        actor.send({ type: "SHUTDOWN" });
        expect(invocations).toBe(1);
        expect(disposals).toBe(1);
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

      it("active.running should not allow INITIALIZE", () => {
        const snapshot = actorAt({ active: "running" }).getSnapshot();
        expect(snapshot.can({ type: "INITIALIZE" })).toBe(false);
      });

      it("active.degraded should not allow INITIALIZE", () => {
        const snapshot = actorAt({ active: "degraded" }).getSnapshot();
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
