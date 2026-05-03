/**
 * Layer A timeout regression tests.
 *
 * Each test wires up a `Browser`/`Page` whose puppeteer methods (one per
 * test) return a promise that never resolves, simulating the real-world
 * pattern observed on JS-redirect pages (itochu.co.jp, imhds.co.jp): the
 * underlying execution context never settles, so the await would hang
 * forever without per-call `withTimeout`.
 *
 * The tests use fake timers and assert that `PageCapturer.capture`
 * surfaces the hang as a `CaptureResult` with `status: "timeout"` and a
 * matching `errorDetails` shape, instead of returning a never-resolving
 * promise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Browser, HTTPResponse, Page } from "puppeteer";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import type { CaptureTask } from "../../src/capture/types.js";
import { logger } from "../../src/logger.js";
import { createTestCaptureConfig } from "../helpers/config.js";

// Stub fs writes so the success-path tests below can run without touching
// disk. The hang/throw timeout cases above bail before reaching captureScreenshot,
// but the new close-timeout tests do hit the screenshot/HTML write step.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, jpeg: false, html: false },
  dismissBanners: false,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

interface MockPageOverrides {
  evaluateHangs?: boolean;
  addStyleTagHangs?: boolean;
  closeHangs?: boolean;
  closeThrows?: Error;
}

const NEVER: Promise<never> = new Promise<never>(() => {
  /* never resolves */
});

interface MockPageBundle {
  page: Page;
  closeMock: ReturnType<typeof vi.fn>;
}

const buildMockPage = (overrides: MockPageOverrides = {}): MockPageBundle => {
  const successResponse = {
    status: () => 200,
    statusText: () => "OK",
  } as unknown as HTTPResponse;

  const closeMock = (() => {
    if (overrides.closeHangs) {
      return vi.fn<() => Promise<void>>().mockReturnValue(NEVER);
    }
    if (overrides.closeThrows) {
      return vi.fn<() => Promise<void>>().mockRejectedValue(overrides.closeThrows);
    }
    return vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  })();

  const page = {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(successResponse),
    evaluate: overrides.evaluateHangs
      ? vi.fn().mockReturnValue(NEVER)
      : vi.fn().mockResolvedValue(undefined),
    addStyleTag: overrides.addStyleTagHangs
      ? vi.fn().mockReturnValue(NEVER)
      : vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake")),
    content: vi.fn().mockResolvedValue("<html></html>"),
    close: closeMock,
  } as unknown as Page;

  return { page, closeMock };
};

interface MockBrowserOverrides extends MockPageOverrides {
  newPageHangs?: boolean;
  outputDir?: string;
}

const buildMockBrowser = (overrides: MockBrowserOverrides = {}): {
  browser: Browser;
  page: Page;
  closeMock: ReturnType<typeof vi.fn>;
} => {
  const { page, closeMock } = buildMockPage(overrides);
  const newPage = overrides.newPageHangs
    ? vi.fn<() => Promise<Page>>().mockReturnValue(NEVER)
    : vi.fn<() => Promise<Page>>().mockResolvedValue(page);
  const browser = { newPage } as unknown as Browser;
  return { browser, page, closeMock };
};

describe("PageCapturer.capture — Layer A timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out when browser.newPage() never resolves", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" })
    );
    const { browser } = buildMockBrowser({ newPageHangs: true });

    const resultPromise = capturer.capture(browser, createTask(), 0);

    // NEW_PAGE_TIMEOUT_MS = 10_000
    await vi.advanceTimersByTimeAsync(10_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.type).toBe("timeout");
    expect(result.errorDetails?.message).toContain("newPage for");
  });

  it("times out when page.evaluate (dynamic-content sleep) never resolves", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" })
    );
    const { browser, closeMock } = buildMockBrowser({ evaluateHangs: true });

    const resultPromise = capturer.capture(browser, createTask(), 0);

    // EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS = DEFAULT_DYNAMIC_CONTENT_WAIT_MS (3000) + 2000 = 5000
    await vi.advanceTimersByTimeAsync(5_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.type).toBe("timeout");
    expect(result.errorDetails?.message).toContain("Dynamic content wait");
    expect(closeMock).toHaveBeenCalled();
  });

  it("times out when page.addStyleTag (hideScrollbars) never resolves", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" })
    );
    const { browser, closeMock } = buildMockBrowser({ addStyleTagHangs: true });

    const resultPromise = capturer.capture(browser, createTask(), 0);

    // STYLE_INJECTION_TIMEOUT_MS = 5_000, applied AFTER the 3s dynamic
    // content sleep finishes — total elapsed before timeout fires = ~8s.
    await vi.advanceTimersByTimeAsync(8_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.type).toBe("timeout");
    expect(result.errorDetails?.message).toContain("hideScrollbars");
    expect(closeMock).toHaveBeenCalled();
  });
});

describe("PageCapturer.capture — page.close timeout in finally", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns within PAGE_CLOSE_TIMEOUT_MS when page.close() hangs (success-path subject)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" }),
    );
    const { browser } = buildMockBrowser({ closeHangs: true });

    const resultPromise = capturer.capture(browser, createTask(), 0);

    // Main pipeline resolves at virtual t=0 (all puppeteer mocks resolve
    // immediately). Then finally → withTimeout(page.close, 5_000) holds
    // the promise until PAGE_CLOSE_TIMEOUT_MS elapses.
    await vi.advanceTimersByTimeAsync(5_001);

    const result = await resultPromise;
    // Close-timeout is best-effort: it must not flip the outer status
    // away from the value the main try-block resolved with.
    expect(result.status).toBe("success");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toContain(
      "page.close failed or timed out",
    );
  });

  it("emits warn and still returns when page.close() throws synchronously rejected", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" }),
    );
    const { browser } = buildMockBrowser({
      closeThrows: new Error("Connection closed"),
    });

    const result = await capturer.capture(browser, createTask(), 0);

    expect(result.status).toBe("success");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not emit warn on the happy path (page.close() resolves)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" }),
    );
    const { browser } = buildMockBrowser();

    const result = await capturer.capture(browser, createTask(), 0);

    expect(result.status).toBe("success");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("preserves inner Layer A timeout status even when close also hangs", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const capturer = new PageCapturer(
      createTestCaptureConfig({ outputDir: "/tmp/bh-test-out" }),
    );
    const { browser } = buildMockBrowser({
      evaluateHangs: true,
      closeHangs: true,
    });

    const resultPromise = capturer.capture(browser, createTask(), 0);

    // Inner page.evaluate (dynamic-content wait) hits its 5s timeout
    // first, then finally → page.close hits its own 5s timeout.
    await vi.advanceTimersByTimeAsync(10_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.message).toContain("Dynamic content wait");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
