/**
 * Tests for `resetPageState` — the inter-task cleanup helper invoked by
 * `PageCapturer.capture` in its finally block.
 *
 * Why these tests exist
 * ---------------------
 * Worker workers reuse a single Chromium tab across every task they
 * process (see `BrowserClient.connect`). The previous design opened and
 * closed a fresh tab per task, which implicitly discarded cookies, DOM
 * state, and execution-context references. Now that responsibility lives
 * in `resetPageState`. These tests pin the contract:
 *
 *   - about:blank navigation is issued (drops origin-scoped storage and
 *     tears down the previous document's JS context).
 *   - `Network.clearBrowserCookies` is sent via a fresh CDP session.
 *   - The CDP session is always detached, even on failure.
 *   - Failures are best-effort: the helper returns normally with a warn
 *     log, never throwing — the (already-completed) capture must not be
 *     poisoned by a wedged reset.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "puppeteer";
import { resetPageState } from "../../src/capture/page-capturer.js";
import type { ResetStateOptions } from "../../src/capture/reset-state.js";
import { logger } from "../../src/logger.js";

const FULL_RESET: ResetStateOptions = { cookies: true, pageContext: true };

interface MockSession {
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
}

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  createCDPSession: ReturnType<typeof vi.fn>;
}

const buildSession = (overrides: Partial<MockSession> = {}): MockSession => ({
  send: overrides.send ?? vi.fn().mockResolvedValue(undefined),
  detach: overrides.detach ?? vi.fn().mockResolvedValue(undefined),
});

const buildPage = (
  session: MockSession,
  overrides: { gotoFails?: boolean } = {},
): MockPage => ({
  goto: overrides.gotoFails
    ? vi.fn().mockRejectedValue(new Error("goto boom"))
    : vi.fn().mockResolvedValue(undefined),
  createCDPSession: vi.fn().mockResolvedValue(session),
});

describe("resetPageState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates to about:blank and clears cookies, then detaches the CDP session", async () => {
    const session = buildSession();
    const page = buildPage(session);

    await resetPageState(page as unknown as Page, 0, FULL_RESET);

    expect(page.goto).toHaveBeenCalledWith("about:blank");
    expect(session.send).toHaveBeenCalledWith("Network.clearBrowserCookies");
    expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it("logs warn and still returns when goto rejects (best-effort contract)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const session = buildSession();
    const page = buildPage(session, { gotoFails: true });

    await expect(
      resetPageState(page as unknown as Page, 7, FULL_RESET),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    // Reset reached the warn before opening a CDP session, so detach is
    // not called. (The CDP session is opened only after goto succeeds.)
    expect(session.send).not.toHaveBeenCalled();
  });

  it("logs warn and still returns when CDP send rejects, after detach runs", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const session = buildSession({
      send: vi.fn().mockRejectedValue(new Error("cdp boom")),
    });
    const page = buildPage(session);

    await expect(
      resetPageState(page as unknown as Page, 0, FULL_RESET),
    ).resolves.toBeUndefined();

    expect(session.detach).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("emits a second warn when session.detach also fails", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const session = buildSession({
      detach: vi.fn().mockRejectedValue(new Error("detach boom")),
    });
    const page = buildPage(session);

    await resetPageState(page as unknown as Page, 0, FULL_RESET);

    // No catch-path failure (send resolved), but detach itself fails →
    // separate warn from the finally branch.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toContain("detach failed");
  });

  describe("per-axis options gating", () => {
    it("is a true no-op when both axes are false (no goto, no CDP session)", async () => {
      const session = buildSession();
      const page = buildPage(session);

      await resetPageState(page as unknown as Page, 0, {
        cookies: false,
        pageContext: false,
      });

      expect(page.goto).not.toHaveBeenCalled();
      expect(page.createCDPSession).not.toHaveBeenCalled();
      expect(session.send).not.toHaveBeenCalled();
      expect(session.detach).not.toHaveBeenCalled();
    });

    it("clears cookies but skips about:blank when cookies-only", async () => {
      const session = buildSession();
      const page = buildPage(session);

      await resetPageState(page as unknown as Page, 0, {
        cookies: true,
        pageContext: false,
      });

      expect(page.goto).not.toHaveBeenCalled();
      expect(session.send).toHaveBeenCalledWith("Network.clearBrowserCookies");
      expect(session.detach).toHaveBeenCalledTimes(1);
    });

    it("navigates to about:blank but skips cookie clear when pageContext-only", async () => {
      const session = buildSession();
      const page = buildPage(session);

      await resetPageState(page as unknown as Page, 0, {
        cookies: false,
        pageContext: true,
      });

      expect(page.goto).toHaveBeenCalledWith("about:blank");
      // No CDP session opened when cookies-axis is disabled.
      expect(page.createCDPSession).not.toHaveBeenCalled();
      expect(session.send).not.toHaveBeenCalled();
      expect(session.detach).not.toHaveBeenCalled();
    });
  });
});
