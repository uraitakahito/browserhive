/**
 * Unit tests for resolveWithInitRetry — the boot-time membership backoff.
 * A recorded `sleep` hook keeps the tests instant while asserting the delays.
 */
import { describe, it, expect, vi } from "vitest";
import { resolveWithInitRetry } from "../../src/discovery/init-retry.js";

const opts = { attempts: 6, delayMs: 500, maxDelayMs: 4000 };

/** A sleep hook that never actually waits but records each requested delay. */
const recordingSleep = () => {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
};

describe("resolveWithInitRetry", () => {
  it("returns immediately when the first resolve succeeds", async () => {
    const resolve = vi.fn().mockResolvedValue(["worker"]);
    const onRetry = vi.fn();
    const result = await resolveWithInitRetry(resolve, opts, { onRetry });
    expect(result).toEqual(["worker"]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("retries until a later attempt succeeds", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("nxdomain"))
      .mockRejectedValueOnce(new Error("nxdomain"))
      .mockResolvedValue(["worker"]);
    const { delays, sleep } = recordingSleep();
    const onRetry = vi.fn();

    const result = await resolveWithInitRetry(resolve, opts, { onRetry, sleep });

    expect(result).toEqual(["worker"]);
    expect(resolve).toHaveBeenCalledTimes(3); // fail, fail, succeed
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([500, 1000]); // exponential backoff between attempts
  });

  it("rethrows the last error after exhausting all attempts", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("nxdomain"));
    const { delays, sleep } = recordingSleep();

    await expect(
      resolveWithInitRetry(resolve, opts, { sleep }),
    ).rejects.toThrow("nxdomain");

    expect(resolve).toHaveBeenCalledTimes(6); // == attempts
    // 5 backoffs between 6 attempts, exponential capped at maxDelayMs.
    expect(delays).toEqual([500, 1000, 2000, 4000, 4000]);
  });

  it("does not retry when attempts is 1", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("nxdomain"));
    const onRetry = vi.fn();
    await expect(
      resolveWithInitRetry(resolve, { ...opts, attempts: 1 }, { onRetry }),
    ).rejects.toThrow("nxdomain");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
