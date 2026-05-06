import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { BrowserProfile } from "../../src/config/index.js";
import type { CaptureTask, CaptureResult } from "../../src/capture/types.js";
import type { Browser, Page } from "puppeteer";
import {
  createTestArtifactStore,
  createTestCaptureConfig,
} from "../helpers/config.js";
import { captureStatus } from "../../src/capture/capture-status.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

// Store mock capture function reference
let mockCapture: Mock;

// Mock modules with factories. The `puppeteerExtra` named export is consumed
// by BrowserClient.connect to manually fire `onPageCreated` on the initial
// tab; in tests we hand it an empty `plugins` array so the loop is a no-op
// but the property still exists to satisfy BrowserClient's interface.
vi.mock("../../src/browser.js", () => ({
  default: vi.fn(),
  puppeteerExtra: { plugins: [] },
}));

// Keep the real `withTimeout` (used by BrowserClient.process for the Layer B
// safety net) while replacing PageCapturer with a stub that delegates to
// `mockCapture`. A bare factory would erase every other export and resolve
// `withTimeout` to undefined, which silently makes the outer setTimeout
// fire immediately and turns every process() result into a "timeout".
vi.mock("../../src/capture/page-capturer.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/capture/page-capturer.js")
  >();
  return {
    ...actual,
    PageCapturer: vi.fn().mockImplementation(function PageCapturer() {
      return {
        capture: (...args: unknown[]) => mockCapture(...args),
      };
    }),
  };
});

// Import after mocking
import { BrowserClient } from "../../src/capture/browser-client.js";
import connectBrowser from "../../src/browser.js";

const createBrowserProfile = (browserURL = "http://chromium:9222"): BrowserProfile => ({
  browserURL,
  capture: createTestCaptureConfig(),
});

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, jpeg: false, html: true, links: false, pdf: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("BrowserClient", () => {
  let client: BrowserClient;
  let mockBrowser: Partial<Browser>;
  let mockPage: Partial<Page>;
  // Captures the listener registered by `BrowserClient.acquirePage` so the
  // page-death tests below can fire it without going through real puppeteer.
  let pageCloseListener: (() => void) | undefined;
  // Same idea for the browser-level `disconnected` listener registered in
  // `BrowserClient.connect`.
  let browserDisconnectedListener: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    pageCloseListener = undefined;
    browserDisconnectedListener = undefined;

    mockPage = {
      isClosed: vi.fn().mockReturnValue(false),
      on: vi.fn().mockImplementation((event: string, listener: () => void) => {
        if (event === "close") pageCloseListener = listener;
        return mockPage as Page;
      }),
    };

    mockBrowser = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      // `connect()` calls `browser.pages()` to acquire the initial tab.
      // Default to a single existing page so the reuse path is exercised;
      // tests that need the `newPage()` fallback override per case.
      pages: vi.fn().mockResolvedValue([mockPage]),
      newPage: vi.fn().mockResolvedValue(mockPage),
      on: vi.fn().mockImplementation((event: string, listener: () => void) => {
        if (event === "disconnected") browserDisconnectedListener = listener;
        return mockBrowser as Browser;
      }),
    };

    mockCapture = vi.fn();

    // Setup connectBrowser mock
    vi.mocked(connectBrowser).mockResolvedValue(mockBrowser as Browser);

    client = new BrowserClient(0, createBrowserProfile(), createTestArtifactStore());
  });

  describe("connect", () => {
    it("should connect to browser with profile and return ok", async () => {
      const result = await client.connect();

      expect(connectBrowser).toHaveBeenCalledWith(
        expect.objectContaining({ browserURL: "http://chromium:9222" })
      );
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("should be connected after successful connection", async () => {
      await client.connect();

      expect(client.isConnected).toBe(true);
    });

    it("should return err with connection ErrorDetails on failure", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Connection failed"));

      const result = await client.connect();

      expect(client.isConnected).toBe(false);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toEqual({
        type: "connection",
        message: "Connection failed",
      });
    });

    it("reuses the upstream's pre-existing initial tab", async () => {
      await client.connect();

      expect(mockBrowser.pages).toHaveBeenCalled();
      expect(mockBrowser.newPage).not.toHaveBeenCalled();
      expect(client.page).toBe(mockPage);
    });

    it("falls back to newPage() when no pre-existing tab is present", async () => {
      const fallbackPage: Partial<Page> = {
        isClosed: vi.fn().mockReturnValue(false),
        on: vi.fn().mockImplementation(function (this: Page) { return this; }),
      };
      mockBrowser.pages = vi.fn().mockResolvedValue([]);
      mockBrowser.newPage = vi.fn().mockResolvedValue(fallbackPage);

      await client.connect();

      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(client.page).toBe(fallbackPage);
    });
  });

  describe("disconnect", () => {
    it("should disconnect browser and return ok", async () => {
      await client.connect();
      const result = await client.disconnect();

      expect(mockBrowser.disconnect).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("should return ok when not connected", async () => {
      const result = await client.disconnect();

      expect(client.isConnected).toBe(false);
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("releases the active page reference on disconnect", async () => {
      await client.connect();
      expect(() => client.page).not.toThrow();

      await client.disconnect();

      expect(() => client.page).toThrow(/no active page/);
    });

    it("clears browser ref on disconnected event so reconnect recreates the browser", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);

      // Simulate the upstream Chromium dropping its CDP WebSocket (e.g.
      // after we externally closed every page; Chromium recreates the
      // browser-level target with a new UUID and the old WS goes dead).
      browserDisconnectedListener?.();

      expect(client.isConnected).toBe(false);
      expect(() => client.page).toThrow(/no active page/);

      // Next coordinator-driven reconnect MUST call connectBrowser again
      // (not just acquirePage) because the old browser ref is unusable.
      await client.connect();
      expect(connectBrowser).toHaveBeenCalledTimes(2);
    });

    it("re-acquires a page on reconnect when the page died but the browser is still alive", async () => {
      // Initial connect: page is held.
      await client.connect();
      expect(() => client.page).not.toThrow();

      // Simulate page-only death (close event fires, browser stays connected).
      pageCloseListener?.();
      expect(() => client.page).toThrow(/no active page/);

      // The coordinator's degraded retry sends CONNECT, which calls connect()
      // again. Without the recovery branch in connect(), the early-return
      // (browser still set) would skip page re-acquisition and leave the
      // worker stuck. With it, acquirePage runs and a fresh page is held.
      const fresh: Partial<Page> = {
        isClosed: vi.fn().mockReturnValue(false),
        on: vi.fn().mockImplementation(function (this: Page) { return this; }),
      };
      mockBrowser.pages = vi.fn().mockResolvedValue([fresh]);

      const result = await client.connect();

      expect(result.ok).toBe(true);
      expect(mockBrowser.pages).toHaveBeenCalled();
      expect(client.page).toBe(fresh);
    });

    it("should release the browser reference and return err on disconnect failure", async () => {
      mockBrowser.disconnect = vi.fn().mockRejectedValue(new Error("Disconnect error"));
      await client.connect();

      const result = await client.disconnect();

      expect(client.isConnected).toBe(false);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toEqual({
        type: "connection",
        message: "Disconnect error",
      });
    });
  });

  describe("process", () => {
    it("should throw when no active page is held (not connected)", async () => {
      const task = createTask();

      await expect(client.process(task)).rejects.toThrow("no active page");
    });

    it("throws connection-error when the page was closed via the close event", async () => {
      await client.connect();
      // Simulate Chromium tearing the tab down: the listener registered in
      // `acquirePage` clears `currentPage`. process() then sees no active page.
      pageCloseListener?.();

      await expect(client.process(createTask())).rejects.toThrow("no active page");
    });

    it("throws connection-error when page.isClosed() returns true (defensive check)", async () => {
      await client.connect();
      // Page reference is still held but Chromium considers it gone — the
      // close event hasn't fired yet. Defensive isClosed() check trips.
      vi.mocked(mockPage.isClosed!).mockReturnValue(true);

      await expect(client.process(createTask())).rejects.toThrow(/page is closed/);
    });

    it("should process task successfully", async () => {
      await client.connect();
      const task = createTask();
      const expectedResult: CaptureResult = {
        task,
        status: captureStatus.success,
        pngLocation: "/path/to/screenshot.png",
        htmlLocation: "/path/to/page.html",
        captureProcessingTimeMs: 1000,
        timestamp: new Date().toISOString(),
        workerIndex: 0,
      };
      mockCapture.mockResolvedValue(expectedResult);

      const result = await client.process(task);

      expect(result.status).toBe(captureStatus.success);
      expect(mockCapture).toHaveBeenCalledWith(
        mockPage,
        task,
        0
      );
    });

    it("converts thrown capture exceptions into a failed CaptureResult", async () => {
      // Layer B: process() catches anything pageCapturer.capture throws and
      // synthesises a CaptureResult so the worker-loop's TASK_FAILED path
      // handles error-history accounting uniformly. The previous contract
      // (re-throw) was changed when Layer B was introduced.
      await client.connect();
      const task = createTask();
      mockCapture.mockRejectedValue(new Error("Unexpected error"));

      const result = await client.process(task);

      expect(result.status).toBe(captureStatus.failed);
      expect(result.errorDetails?.type).toBe("internal");
      expect(result.errorDetails?.message).toBe("Unexpected error");
    });

    it("should return capture result including error details", async () => {
      await client.connect();
      const task = createTask();
      const failedResult: CaptureResult = {
        task,
        status: captureStatus.failed,
        errorDetails: {
          type: "internal",
          message: "Capture failed",
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerIndex: 0,
      };
      mockCapture.mockResolvedValue(failedResult);

      const result = await client.process(task);

      expect(result.status).toBe(captureStatus.failed);
      expect(result.errorDetails?.message).toBe("Capture failed");
    });

    describe("Layer B taskTotal timeout", () => {
      // Layer B is the outer per-task safety net wired in
      // BrowserClient.process. When the inner pageCapturer.capture promise
      // never resolves (the symptom we observed on JS-redirect pages whose
      // execution context never settles), the outer withTimeout must return
      // a CaptureResult with status=timeout so the worker-loop can move on.
      // The inner promise being abandoned and leaking the remote Page is an
      // accepted tradeoff — see browser-client.ts process() doc comment.
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("returns timeout CaptureResult when pageCapturer.capture never resolves", async () => {
        // Use a short taskTotal so the test is fast; default is 100s.
        const shortTimeout = 100;
        const fastClient = new BrowserClient(
          0,
          {
            browserURL: "http://chromium:9222",
            capture: {
              ...createBrowserProfile().capture,
              timeouts: {
                ...createBrowserProfile().capture.timeouts,
                taskTotal: shortTimeout,
              },
            },
          },
          createTestArtifactStore(),
        );
        // connectBrowser is mocked at module scope; await connect to set
        // the internal browser reference on this fresh client too.
        await fastClient.connect();

        const task = createTask();
        mockCapture.mockReturnValue(
          new Promise<never>(() => {
            /* never resolves — simulates a wedged puppeteer call that no
               Layer A timeout fired on */
          }),
        );

        const resultPromise = fastClient.process(task);

        await vi.advanceTimersByTimeAsync(shortTimeout + 1);

        const result = await resultPromise;
        expect(result.status).toBe(captureStatus.timeout);
        expect(result.errorDetails?.type).toBe("timeout");
        expect(result.errorDetails?.timeoutMs).toBe(shortTimeout);
        expect(result.errorDetails?.message).toContain("Task processing for");
        expect(result.workerIndex).toBe(0);
      });
    });
  });

  describe("isConnected", () => {
    it("should return false when not connected", () => {
      expect(client.isConnected).toBe(false);
    });

    it("should return true when connected", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);
    });

    it("should return false after disconnect", async () => {
      await client.connect();
      await client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });

  describe("properties", () => {
    it("should expose index", () => {
      const w = new BrowserClient(3, createBrowserProfile(), createTestArtifactStore());
      expect(w.index).toBe(3);
    });

    it("should expose logger", () => {
      expect(client.logger).toBeDefined();
    });
  });
});
