import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActor } from "xstate";
import { initializeWorkers, waitForWorkersToReach } from "../../src/capture/coordinator-actors.js";
import type { WorkerEntry } from "../../src/capture/coordinator-machine.js";

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
 * `subscribe`, and `worker.profile.browserURL`.
 */
const fakeInitEntry = (browserURL = "http://test:9222") => {
  interface FakeSnapshot {
    value: unknown;
    hasTag: (tag: string) => boolean;
  }
  const listeners = new Set<(snap: FakeSnapshot) => void>();
  let value: unknown = "connecting";
  let tags = new Set<string>();

  const snap = (): FakeSnapshot => ({
    value,
    hasTag: (t) => tags.has(t),
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
    setError: (): void => {
      value = "error";
      tags = new Set();
      notify();
    },
    send,
  };
};

/**
 * Run an `initializeWorkers` actor and return a promise that settles
 * with the actor's done/error outcome. Uses the observer-object form
 * of `subscribe` so that promise-actor rejections are routed through
 * the `error` callback instead of becoming unhandled exceptions.
 */
const runInitializeWorkers = (workers: WorkerEntry[]): {
  actor: ReturnType<typeof createActor<typeof initializeWorkers>>;
  settled: Promise<undefined>;
} => {
  const actor = createActor(initializeWorkers, { input: { workers } });
  const settled = new Promise<undefined>((resolve, reject) => {
    actor.subscribe({
      next: (snapshot) => {
        if (snapshot.status === "done") {
          resolve(snapshot.output);
        }
      },
      error: (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
  actor.start();
  return { actor, settled };
};

describe("initializeWorkers", () => {
  describe("happy path", () => {
    it("resolves when all workers reach operational", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);

      a.setOperational();
      b.setOperational();

      await expect(settled).resolves.toBeUndefined();
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
    it("rejects when workers array is empty", async () => {
      const { settled } = runInitializeWorkers([]);
      await expect(settled).rejects.toThrow("No browser profiles configured.");
    });

    it("rejects when one worker is in error", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b-failed:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setOperational();
      b.setError();

      const error = await settled.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Worker initialization failed: 1\/2 operational/);
      expect((error as Error).message).toMatch(/http:\/\/b-failed:9222/);
    });

    it("rejects when all workers are in error", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setError();
      b.setError();

      await expect(settled).rejects.toThrow(/Worker initialization failed: 0\/2 operational/);
    });
  });

  describe("timeout path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects when at least one worker fails to settle within the timeout", async () => {
      const a = fakeInitEntry("http://a:9222");
      const slow = fakeInitEntry("http://slow:9222"); // never settles

      const { settled } = runInitializeWorkers([a.entry, slow.entry]);
      // Attach the catch handler eagerly so the rejection is never observed
      // as unhandled when fake-timer advancement triggers it.
      const errorPromise = settled.catch((e: unknown) => e);
      a.setOperational();

      // Worker init timeout is 30s; advance past it to trigger the warn + final check
      await vi.advanceTimersByTimeAsync(30_000);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/1\/2 operational/);
      expect((error as Error).message).toMatch(/http:\/\/slow:9222/);
    });
  });
});
