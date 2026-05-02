import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActor } from "xstate";
import {
  initializeWorkers,
  retryFailedWorkers,
  waitForWorkersToReach,
  type InitializeWorkersOutput,
} from "../../src/capture/coordinator-actors.js";
import type { WorkerEntry } from "../../src/capture/coordinator-machine.js";
import type { ErrorRecord } from "../../src/capture/types.js";
import { errorType } from "../../src/capture/error-type.js";
import type { CaptureWorkerSnapshot } from "../../src/capture/capture-worker.js";

/**
 * Minimal ActorRef-shaped fake. Only `getSnapshot` and `subscribe` are
 * exercised by waitForWorkersToReach, so the rest of the WorkerEntry
 * (`client`) is filled in with a placeholder. The snapshot exposes
 * `matches` so predicates that call `snapshot.matches(target)`
 * (the production shape) work without spinning up a real machine.
 */
const fakeEntry = (initialValue: string) => {
  interface FakeSnapshot {
    value: string;
    matches: (target: string) => boolean;
  }
  const listeners = new Set<(snap: FakeSnapshot) => void>();
  let value = initialValue;
  const makeSnapshot = (): FakeSnapshot => ({
    value,
    matches: (target) => target === value,
  });
  const entry = {
    ref: {
      getSnapshot: makeSnapshot,
      subscribe: (listener: (snap: FakeSnapshot) => void) => {
        listeners.add(listener);
        return {
          unsubscribe: () => {
            listeners.delete(listener);
          },
        };
      },
    },
    client: {} as never,
  } as unknown as WorkerEntry;

  return {
    entry,
    setValue: (v: string) => {
      value = v;
      listeners.forEach((l) => { l(makeSnapshot()); });
    },
    listenerCount: () => listeners.size,
  };
};

// "ready" is a synthetic state used only by these standalone waitForWorkersToReach
// tests — it is not a real captureWorkerMachine state, so we cast through `never`
// to satisfy the predicate's typed signature.
const isReady = (snap: CaptureWorkerSnapshot): boolean => snap.matches("ready" as never);

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
 * depends on: `send`, `getSnapshot().value`, `getSnapshot().matches()`,
 * `getSnapshot().hasTag()`, `getSnapshot().context.errorHistory`,
 * `subscribe`, and `worker.profile.browserURL`.
 */
const fakeInitEntry = (browserURL = "http://test:9222") => {
  interface FakeSnapshot {
    value: unknown;
    matches: (target: string) => boolean;
    hasTag: (tag: string) => boolean;
    context: { errorHistory: ErrorRecord[] };
  }
  const listeners = new Set<(snap: FakeSnapshot) => void>();
  let value: unknown = "connecting";
  let tags = new Set<string>();
  let errorHistory: ErrorRecord[] = [];

  const matches = (target: string): boolean => {
    if (typeof value === "string") return value === target;
    if (typeof value === "object" && value !== null) {
      return target in (value as Record<string, unknown>);
    }
    return false;
  };

  const snap = (): FakeSnapshot => ({
    value,
    matches,
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
    client: {
      profile: { browserURL },
    },
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
  settled: Promise<InitializeWorkersOutput>;
} => {
  const actor = createActor(initializeWorkers, { input: { workers } });
  const settled = new Promise<InitializeWorkersOutput>((resolve, reject) => {
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
    it("reports allHealthy when all workers reach operational", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);

      a.setOperational();
      b.setOperational();

      await expect(settled).resolves.toEqual({ allHealthy: true, failed: [] });
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

    it("reports allHealthy with empty workers array (no profiles)", async () => {
      const { settled } = runInitializeWorkers([]);
      await expect(settled).resolves.toEqual({ allHealthy: true, failed: [] });
    });
  });

  describe("partial / total failure (still resolves successfully)", () => {
    it("includes the failing worker's last errorHistory entry", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b-failed:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setOperational();
      b.setError(httpErrorRecord("ECONNREFUSED"));

      const result = await settled;
      expect(result).toEqual({
        allHealthy: false,
        failed: [
          {
            browserURL: "http://b-failed:9222",
            reason: httpErrorRecord("ECONNREFUSED"),
          },
        ],
      });
    });

    it("synthesizes a reason when worker has no errorHistory entry", async () => {
      const a = fakeInitEntry("http://a:9222");

      const { settled } = runInitializeWorkers([a.entry]);
      a.setError();

      const result = await settled;
      expect(result.allHealthy).toBe(false);
      expect(result.failed).toEqual([
        {
          browserURL: "http://a:9222",
          reason: {
            type: "connection",
            message: "Unknown failure (no error recorded)",
          },
        },
      ]);
    });

    it("reports every failure when all workers are in error", async () => {
      const a = fakeInitEntry("http://a:9222");
      const b = fakeInitEntry("http://b:9222");

      const { settled } = runInitializeWorkers([a.entry, b.entry]);
      a.setError(httpErrorRecord("a down"));
      b.setError(httpErrorRecord("b down"));

      const result = await settled;
      expect(result.allHealthy).toBe(false);
      expect(result.failed.map((f) => f.browserURL)).toEqual([
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

    it("reports the unsettled worker as failed when one fails to settle in time", async () => {
      const a = fakeInitEntry("http://a:9222");
      const slow = fakeInitEntry("http://slow:9222"); // never settles

      const { settled } = runInitializeWorkers([a.entry, slow.entry]);
      a.setOperational();

      // Worker init timeout is 30s; advance past it to trigger the warn + final check
      await vi.advanceTimersByTimeAsync(30_000);

      const result = await settled;
      expect(result.allHealthy).toBe(false);
      expect(result.failed.map((f) => f.browserURL)).toEqual([
        "http://slow:9222",
      ]);
    });
  });
});

/**
 * Minimal worker fake for retryFailedWorkers tests.
 * Tracks the value (we only need to flip between "error" and other), and
 * records each `send` so we can assert reconnect attempts.
 */
const fakeRetryEntry = (browserURL: string, initialValue: unknown = "error") => {
  let value = initialValue;
  const send = vi.fn();
  const entry = {
    ref: {
      getSnapshot: () => ({ value }),
      send,
    },
    client: {
      profile: { browserURL },
    },
  } as unknown as WorkerEntry;
  return {
    entry,
    setValue: (v: unknown): void => {
      value = v;
    },
    send,
  };
};

describe("retryFailedWorkers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends CONNECT to error-state workers after the initial 1s backoff", async () => {
    const a = fakeRetryEntry("http://a:9222", "error");
    const actor = createActor(retryFailedWorkers, { input: [a.entry] });
    actor.start();

    expect(a.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.send).toHaveBeenCalledWith({ type: "CONNECT" });

    actor.stop();
  });

  it("uses exponential backoff (1s, 2s, 4s, ...)", async () => {
    const a = fakeRetryEntry("http://a:9222", "error");
    const actor = createActor(retryFailedWorkers, { input: [a.entry] });
    actor.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(a.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(a.send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(a.send).toHaveBeenCalledTimes(3);

    actor.stop();
  });

  it("caps backoff at 60s", async () => {
    const a = fakeRetryEntry("http://a:9222", "error");
    const actor = createActor(retryFailedWorkers, { input: [a.entry] });
    actor.start();

    // 1+2+4+8+16+32 = 63s → 6 attempts
    await vi.advanceTimersByTimeAsync(63_000);
    expect(a.send).toHaveBeenCalledTimes(6);

    // The next delay would be 64s, but it's clamped to 60s.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.send).toHaveBeenCalledTimes(7);

    actor.stop();
  });

  it("skips workers that are no longer in error state", async () => {
    const a = fakeRetryEntry("http://a:9222", "error");
    const b = fakeRetryEntry("http://b:9222", { operational: "idle" });
    const actor = createActor(retryFailedWorkers, { input: [a.entry, b.entry] });
    actor.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(a.send).toHaveBeenCalledWith({ type: "CONNECT" });
    expect(b.send).not.toHaveBeenCalled();

    actor.stop();
  });

  it("stops scheduling after the actor is stopped", async () => {
    const a = fakeRetryEntry("http://a:9222", "error");
    const actor = createActor(retryFailedWorkers, { input: [a.entry] });
    actor.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(a.send).toHaveBeenCalledTimes(1);

    actor.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.send).toHaveBeenCalledTimes(1);
  });
});

