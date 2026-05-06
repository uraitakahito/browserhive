/**
 * Layer A timeout regression tests.
 *
 * Each test wires up a `Page` whose puppeteer methods (one per test) return
 * a promise that never resolves, simulating the real-world pattern observed
 * on JS-redirect pages (itochu.co.jp, imhds.co.jp): the underlying execution
 * context never settles, so the await would hang forever without per-call
 * `withTimeout`.
 *
 * The tests use fake timers and assert that `PageCapturer.capture` surfaces
 * the hang as a `CaptureResult` with `status: "timeout"` and a matching
 * `errorDetails` shape, instead of returning a never-resolving promise.
 *
 * Page lifecycle is owned by `BrowserClient` (one persistent tab per worker)
 * — `capture` no longer creates or closes pages, so the previous
 * `browser.newPage()` and `page.close()` timeout cases are gone.
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

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

interface MockPageOverrides {
  evaluateHangs?: boolean;
  addStyleTagHangs?: boolean;
}

const NEVER: Promise<never> = new Promise<never>(() => {
  /* never resolves */
});

const buildMockPage = (overrides: MockPageOverrides = {}): Page => {
  const successResponse = {
    status: () => 200,
    statusText: () => "OK",
  } as unknown as HTTPResponse;

  return {
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
    // resetPageState runs in the capture finally block (regardless of the
    // try/catch outcome). Each test below exercises a Layer A timeout that
    // lands in catch, then drops through finally.
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Page;
};

describe("PageCapturer.capture — Layer A timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out when page.evaluate (dynamic-content sleep) never resolves", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig(),
      createTestArtifactStore(),
    );
    const page = buildMockPage({ evaluateHangs: true });

    const resultPromise = capturer.capture(page, createTask(), 0);

    // EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS = DEFAULT_DYNAMIC_CONTENT_WAIT_MS (3000) + 2000 = 5000
    await vi.advanceTimersByTimeAsync(5_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.type).toBe("timeout");
    expect(result.errorDetails?.message).toContain("Dynamic content wait");
  });

  it("times out when page.addStyleTag (hideScrollbars) never resolves", async () => {
    const capturer = new PageCapturer(
      createTestCaptureConfig(),
      createTestArtifactStore(),
    );
    const page = buildMockPage({ addStyleTagHangs: true });

    const resultPromise = capturer.capture(page, createTask(), 0);

    // STYLE_INJECTION_TIMEOUT_MS = 5_000, applied AFTER the 3s dynamic
    // content sleep finishes — total elapsed before timeout fires = ~8s.
    await vi.advanceTimersByTimeAsync(8_001);

    const result = await resultPromise;
    expect(result.status).toBe("timeout");
    expect(result.errorDetails?.type).toBe("timeout");
    expect(result.errorDetails?.message).toContain("hideScrollbars");
  });
});
