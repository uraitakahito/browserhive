/**
 * Unit tests for `runOnStableContext` — the helper that retries puppeteer
 * operations across "Execution context was destroyed, most likely because
 * of a navigation." rejections so JS-redirecting top pages can still be
 * captured (see `data/js-redirect.yaml` for the production URLs that
 * motivated this helper).
 *
 * These tests target the helper directly with Page mocks, so they are
 * agnostic of which puppeteer call (evaluate / addStyleTag / screenshot /
 * content) is being retried — the helper's contract is the same for all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Page } from "puppeteer";
import { runOnStableContext } from "../../src/capture/page-capturer.js";

const DESTROYED_MESSAGE =
  "Execution context was destroyed, most likely because of a navigation.";

const NEVER: Promise<never> = new Promise<never>(() => {
  /* never resolves */
});

interface MockPageOpts {
  /** When set, page.waitForNavigation never resolves (simulates "redirect already settled"). */
  waitForNavigationHangs?: boolean;
}

const buildMockPage = (opts: MockPageOpts = {}): {
  page: Page;
  waitForNavigation: ReturnType<typeof vi.fn>;
} => {
  const waitForNavigation = opts.waitForNavigationHangs
    ? vi.fn().mockReturnValue(NEVER)
    : vi.fn().mockResolvedValue(undefined);
  const page = { waitForNavigation } as unknown as Page;
  return { page, waitForNavigation };
};

describe("runOnStableContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry when the operation succeeds on first try", async () => {
    const { page, waitForNavigation } = buildMockPage();
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await runOnStableContext(page, operation, "test op", 5_000);

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waitForNavigation).not.toHaveBeenCalled();
  });

  it("retries once and succeeds when first call throws destroyed-context", async () => {
    const { page, waitForNavigation } = buildMockPage();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockResolvedValueOnce("ok-after-1-redirect");

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    // Allow the destroyed throw to propagate and waitForNavigation to resolve.
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("ok-after-1-redirect");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(waitForNavigation).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxRetries (default 2) before giving up", async () => {
    const { page } = buildMockPage();
    // 3 attempts (1 initial + 2 retries) → all destroyed-context.
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE));

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    // Attach the rejection assertion eagerly so the eventual throw is
    // already "handled" by the time fake timers fire — otherwise vitest
    // reports a transient unhandled-rejection warning between the timer
    // callback and the assertion's await.
    const expectation = expect(promise).rejects.toThrow(
      /Execution context was destroyed/,
    );
    // Drive each settle wait to completion so the retry loop advances.
    await vi.runAllTimersAsync();
    await expectation;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("succeeds within maxRetries when a chained redirect settles on attempt 3", async () => {
    const { page, waitForNavigation } = buildMockPage();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockResolvedValueOnce("ok-after-2-redirects");

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("ok-after-2-redirects");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waitForNavigation).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on errors other than destroyed-context", async () => {
    const { page, waitForNavigation } = buildMockPage();
    const httpError = new Error("HTTP 404: Not Found");
    const operation = vi.fn().mockRejectedValue(httpError);

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    const expectation = expect(promise).rejects.toBe(httpError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(operation).toHaveBeenCalledTimes(1);
    expect(waitForNavigation).not.toHaveBeenCalled();
  });

  it("treats a hung waitForNavigation as 'already settled' and retries anyway", async () => {
    // Simulates the race where the redirect's DOMContentLoaded fires before
    // we attach the waitForNavigation listener. Helper must time out the
    // settle wait and proceed to the retry, not deadlock.
    const { page, waitForNavigation } = buildMockPage({
      waitForNavigationHangs: true,
    });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error(DESTROYED_MESSAGE))
      .mockResolvedValueOnce("ok-after-missed-event");

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    // Advance past STABLE_CONTEXT_SETTLE_TIMEOUT_MS (3_000). One extra ms
    // ensures the timeoutPromise rejects and the loop falls through to retry.
    await vi.advanceTimersByTimeAsync(3_001);

    const result = await promise;
    expect(result).toBe("ok-after-missed-event");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(waitForNavigation).toHaveBeenCalledTimes(1);
  });

  it("propagates the operation's per-attempt withTimeout when the operation hangs", async () => {
    // Genuine hang (not destroyed-context). The Layer A withTimeout inside
    // the helper must still fire and surface the timeout as a failure.
    const { page } = buildMockPage();
    const operation = vi.fn<() => Promise<string>>().mockReturnValue(NEVER);

    const promise = runOnStableContext(page, operation, "test op", 5_000);
    const expectation = expect(promise).rejects.toThrow(/Timeout: test op/);
    await vi.advanceTimersByTimeAsync(5_001);
    await expectation;
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
