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
import { createTestCaptureConfig } from "../helpers/config.js";

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, jpeg: false, html: false },
  dismissBanners: false,
  ...overrides,
});

interface MockPageOverrides {
  evaluateHangs?: boolean;
  addStyleTagHangs?: boolean;
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

  const closeMock = vi.fn().mockResolvedValue(undefined);

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
