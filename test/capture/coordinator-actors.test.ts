import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForWorkersToReach } from "../../src/capture/coordinator-actors.js";
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
