import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActor } from "xstate";
import { initializeWorkers, waitForWorkersToReach } from "../../src/capture/coordinator-actors.js";
import type { CoordinatorInitFailure } from "../../src/capture/coordinator-errors.js";
import type { WorkerEntry } from "../../src/capture/coordinator-machine.js";
import type { ErrorRecord } from "../../src/capture/types.js";
import { errorType } from "../../src/capture/error-type.js";
import type { Result } from "../../src/result.js";

/**
 * Minimal ActorRef-shaped fake. Only `getSnapshot` and `subscribe` are
 * exercised by waitForWorkersToReach, so the rest of the WorkerEntry
 * (`worker`, `index`) is filled in with placeholders.
 */
const fakeEntry = (initialValue: string) => {
  const listeners = new Set<(snap: { value: string }) => void>();
  let value = initialValue;
  const entry = {
    ref: {
      getSnapshot: () => ({ value }),
      subscribe: (listener: (snap: { value: string }) => void) => {
        listeners.add(listener);
        return {
          unsubscribe: () => {
            listeners.delete(listener);
          },
        };
      },
    },
    worker: {} as never,
    index: 0,
  } as unknown as WorkerEntry;

  return {
    entry,
    setValue: (v: string) => {
      value = v;
      listeners.forEach((l) => { l({ value }); });
    },
    listenerCount: () => listeners.size,
  };
};

const isReady = (v: unknown): boolean => v === "ready";

describe("waitForWorkersToReach", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("happy path", () => {
    it("resolves immediately for empty workers array; onTimeout not called", async () => {
      const onTimeout = vi.fn();
      await waitForWorkersToReach([], isReady, { timeoutMs: 1000, onTimeout });
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("resolves immediately when all workers already match predicate", async () => {
      const a = fakeEntry("ready");
      const b = fakeEntry("ready");
      const onTimeout = vi.fn();

      await waitForWorkersToReach([a.entry, b.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      expect(onTimeout).not.toHaveBeenCalled();
      expect(a.listenerCount()).toBe(0);
      expect(b.listenerCount()).toBe(0);
    });

    it("resolves before timeout when all workers settle in time", async () => {
      const a = fakeEntry("connecting");
      const b = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry, b.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      a.setValue("ready");
      b.setValue("ready");
      await promise;

      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe("timeout path", () => {
    it("calls onTimeout once after timeoutMs when no worker settles", async () => {
      const a = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      expect(onTimeout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("times out when at least one worker stays unsettled", async () => {
      const fast = fakeEntry("connecting");
      const slow = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([fast.entry, slow.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      fast.setValue("ready");
      // slow stays in "connecting"
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("calls onTimeout exactly once even if time advances well past timeoutMs", async () => {
      const a = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanup invariants", () => {
    it("unsubscribes every worker subscription on success", async () => {
      const a = fakeEntry("connecting");
      const b = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry, b.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      a.setValue("ready");
      b.setValue("ready");
      await promise;

      expect(a.listenerCount()).toBe(0);
      expect(b.listenerCount()).toBe(0);
    });

    it("unsubscribes every worker subscription on timeout", async () => {
      const a = fakeEntry("connecting");
      const b = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry, b.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(a.listenerCount()).toBe(0);
      expect(b.listenerCount()).toBe(0);
    });

    // Regression: prior to the clearTimeout fix, the setTimeout callback
    // still fired (and emitted the warn) after a successful settle.
    it("does not call onTimeout after success even if time advances past timeoutMs", async () => {
      const a = fakeEntry("connecting");
      const onTimeout = vi.fn();

      const promise = waitForWorkersToReach([a.entry], isReady, {
        timeoutMs: 1000,
        onTimeout,
      });

      a.setValue("ready");
      await promise;
      expect(onTimeout).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});

/**
 * Fake WorkerEntry with state controls for initializeWorkers tests.
 * Reproduces the worker status machine surface that initializeWorkers
 * depends on: `send`, `getSnapshot().value`, `getSnapshot().hasTag()`,
 * `getSnapshot().context.errorHistory`, `subscribe`, and
 * `worker.profile.browserURL`.
 */
const fakeInitEntry = (browserURL = "http://test:9222") => {
  interface FakeSnapshot {
    value: unknown;
    hasTag: (tag: string) => boolean;
    context: { errorHistory: ErrorRecord[] };
  }
  const listeners = new Set<(snap: FakeSnapshot) => void>();
  let value: unknown = "connecting";
  let tags = new Set<string>();
  let errorHistory: ErrorRecord[] = [];

  const snap = (): FakeSnapshot => ({
    value,
    hasTag: (t) => tags.has(t),
    context: { errorHistory },
  });
  const notify = (): void => {
    listeners.forEach((l) => { l(snap()); });
  };

  const send = vi.fn();

  const entry = {
    ref: {
      getSnapshot: snap,
      subscribe: (listener: (s: FakeSnapshot) => void) => {
        listeners.add(listener);
        return {
          unsubscribe: (): void => { listeners.delete(listener); },
        };
      },
      send,
    },
    worker: {
      profile: { browserURL },
    },
    index: 0,
  } as unknown as WorkerEntry;

  return {
    entry,
    setOperational: (): void => {
      value = { operational: "idle" };
      tags = new Set(["healthy", "canProcess"]);
      notify();
    },
    setError: (record?: ErrorRecord): void => {
      value = "error";
      tags = new Set();
      if (record) errorHistory = [record];
      notify();
    },
    send,
  };
};

/**
 * Run an `initializeWorkers` actor and return a promise that settles
 * with the actor's Result output. Uses the observer-object form of
 * `subscribe` so any unexpected actor error is routed through the
 * `error` callback instead of becoming an unhandled exception.
 */
const runInitializeWorkers = (workers: WorkerEntry[]): {
  actor: ReturnType<typeof createActor<typeof initializeWorkers>>;
  settled: Promise<Result<void, CoordinatorInitFailure>>;
} => {
  const actor = createActor(initializeWorkers, { input: { workers } });
  const settled = new Promise<Result<void, CoordinatorInitFailure>>((resolve, reject) => {
    actor.subscribe({
      next: (snapshot) => {
        if (snapshot.status === "done") {
          resolve(snapshot.output);
        }
      },
      error: (e: unknown) => {
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    });
  });
  actor.start();
  return { actor, settled };
};

const httpErrorRecord = (message: string): ErrorRecord => ({
  type: errorType.connection,
  message,
  timestamp: "2026-01-01T00:00:00.000Z",
});

describe("initializeWorkers", () => {
  describe("happy path", () => {
    it("resolves to ok when all workers reach operational", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);

      a.setOperational();
      b.setOperational();

      await expect(settled).resolves.toEqual({ ok: true, value: undefined });
    });

    it("sends CONNECT to every worker", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setOperational();
      b.setOperational();
      await settled;

      expect(a.send).toHaveBeenCalledWith({ type: "CONNECT" });
      expect(b.send).toHaveBeenCalledWith({ type: "CONNECT" });
    });
  });

  describe("failure paths", () => {
    it('returns no-profiles failure when workers array is empty', async () => {
      const { settled } = runInitializeWorkers([]);
      await expect(settled).resolves.toEqual({
        ok: false,
        error: { kind: "no-profiles" },
      });
    });

    it("returns partial-failure when one worker is in error, including its last errorHistory entry", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b-failed:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setOperational();
      b.setError(httpErrorRecord("ECONNREFUSED"));

      const result = await settled;
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "partial-failure",
          operational: 1,
          total: 2,
          failed: [
            {
              browserURL: "http://b-failed:9222",
              reason: httpErrorRecord("ECONNREFUSED"),
            },
          ],
        },
      });
    });

    it("returns partial-failure with synthetic reason when worker has no errorHistory entry", async () => {
      const a = fakeInitEntry("http://a:9222");

      const { settled } = runInitializeWorkers([a.entry]);
      a.setError();

      const result = await settled;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("partial-failure");
      if (result.error.kind !== "partial-failure") throw new Error("unreachable");
      expect(result.error.failed).toEqual([
        {
          browserURL: "http://a:9222",
          reason: {
            type: "connection",
            message: "Unknown failure (no error recorded)",
          },
        },
      ]);
    });

    it("returns partial-failure when all workers are in error", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setError(httpErrorRecord("a down"));
      b.setError(httpErrorRecord("b down"));

      const result = await settled;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("partial-failure");
      if (result.error.kind !== "partial-failure") throw new Error("unreachable");
      expect(result.error.operational).toBe(0);
      expect(result.error.total).toBe(2);
      expect(result.error.failed.map((f) => f.browserURL)).toEqual([
        "http://a:9222",
        "http://b:9222",
      ]);
    });
  });

  describe("timeout path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns partial-failure when at least one worker fails to settle within the timeout", async () => {
      const a = fakeInitEntry("http://a:9222");
      const slow = fakeInitEntry("http://slow:9222"); // never settles

      const { settled } = runInitializeWorkers([a.entry, slow.entry]);
      a.setOperational();

      // Worker init timeout is 30s; advance past it to trigger the warn + final check
      await vi.advanceTimersByTimeAsync(30_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("partial-failure");
      if (result.error.kind !== "partial-failure") throw new Error("unreachable");
      expect(result.error.operational).toBe(1);
      expect(result.error.total).toBe(2);
      expect(result.error.failed.map((f) => f.browserURL)).toEqual([
        "http://slow:9222",
      ]);
    });
  });
});
