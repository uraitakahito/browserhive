/**
 * Integration tests for PageCapturer.capture across redirect-induced
 * destroyed-context errors.
 *
 * The retry contract of `runOnStableContext` itself is covered exhaustively
 * in `page-capturer-stable-context.test.ts`. This file pins down a
 * complementary property: the capture pipeline as a whole
 * (goto → evaluate → addStyleTag → screenshot → content) routes EVERY
 * execution-context-bound operation through that helper, so a 1-step JS
 * redirect like the ones in `data/js-redirect.yaml`:
 *
 *   * https://www.imhds.co.jp/         →  /corporate/index_en.html
 *   * https://www.itochu.co.jp/        →  /ja/
 *   * https://www.daiwahouse.com/      →  /jp/
 *
 * still yields a `status: success` result with all requested formats
 * written, instead of bailing out on the first destroyed-context throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HTTPResponse, Page } from "puppeteer";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import type { CaptureTask } from "../../src/capture/types.js";
import {
  createTestArtifactStore,
  createTestCaptureConfig,
} from "../helpers/config.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

const DESTROYED =
  "Execution context was destroyed, most likely because of a navigation.";

const createTask = (): CaptureTask => ({
  taskId: "redirect-test-task",
  labels: ["3099", "IsetanMitsukoshi"],
  url: "https://www.imhds.co.jp/",
  retryCount: 0,
  captureFormats: { png: false, webp: true, html: true, links: false, mhtml: false, wacz: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
});

interface RedirectMockOpts {
  /** First call rejects with destroyed-context, second resolves normally. */
  evaluateDestroysOnce?: boolean;
  screenshotDestroysOnce?: boolean;
  contentDestroysOnce?: boolean;
}

/**
 * Build a single-rejection-then-resolve mock for one of the puppeteer methods
 * we route through `runOnStableContext`. The first invocation rejects with
 * the destroyed-context message — exactly what we observe on imhds.co.jp /
 * itochu.co.jp / daiwahouse.com when their JS redirect lands during the call.
 */
const oneShotDestroyed = (resolveValue: unknown): ReturnType<typeof vi.fn> => {
  let called = 0;
  return vi.fn().mockImplementation(() => {
    called += 1;
    if (called === 1) return Promise.reject(new Error(DESTROYED));
    return Promise.resolve(resolveValue);
  });
};

const buildPage = (opts: RedirectMockOpts = {}): Page => {
  const successResponse = {
    status: () => 200,
    statusText: () => "OK",
  } as unknown as HTTPResponse;

  const evaluate = opts.evaluateDestroysOnce
    ? oneShotDestroyed(undefined)
    : vi.fn().mockResolvedValue(undefined);

  const screenshot = opts.screenshotDestroysOnce
    ? oneShotDestroyed(Buffer.from("img"))
    : vi.fn().mockResolvedValue(Buffer.from("img"));

  const content = opts.contentDestroysOnce
    ? oneShotDestroyed("<html></html>")
    : vi.fn().mockResolvedValue("<html></html>");

  return {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(successResponse),
    evaluate,
    addStyleTag: vi.fn().mockResolvedValue(undefined),
    screenshot,
    content,
    // After a destroyed-context throw the helper waits for the next
    // navigation. Resolving immediately lets the retry proceed without
    // burning the settle timeout.
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    // resetPageState (called from the capture finally block) opens a CDP
    // session and sends Network.clearBrowserCookies; stub the minimum that
    // satisfies that path so the test isn't a destructive-context retry +
    // a separate "session detach" warn.
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Page;
};

describe("PageCapturer.capture — redirect-induced destroyed-context recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers when page.evaluate (dynamic-content wait) destroys context once", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig(),
      createTestArtifactStore(),
    );
    const page = buildPage({ evaluateDestroysOnce: true });

    const promise = capturer.capture(page, createTask(), 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.webpLocation).toBeDefined();
    expect(result.htmlLocation).toBeDefined();
  });

  it("recovers when page.screenshot destroys context once", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig(),
      createTestArtifactStore(),
    );
    const page = buildPage({ screenshotDestroysOnce: true });

    const promise = capturer.capture(page, createTask(), 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.webpLocation).toBeDefined();
  });

  it("recovers when page.content (HTML) destroys context once", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig(),
      createTestArtifactStore(),
    );
    const page = buildPage({ contentDestroysOnce: true });

    const promise = capturer.capture(page, createTask(), 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.htmlLocation).toBeDefined();
  });
});
