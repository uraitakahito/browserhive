import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { BrowserProfile } from "../../src/config/index.js";
import type { CaptureTask, CaptureResult } from "../../src/capture/types.js";
import type { Browser } from "puppeteer";
import { createTestCaptureConfig } from "../helpers/config.js";
import { captureStatus } from "../../src/capture/capture-status.js";

// Store mock capture function reference
let mockCapture: Mock;

// Mock modules with factories
vi.mock("../../src/browser.js", () => ({
  default: vi.fn(),
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
  captureFormats: { png: true, jpeg: false, html: true },
  dismissBanners: false,
  ...overrides,
});

describe("BrowserClient", () => {
  let client: BrowserClient;
  let mockBrowser: Partial<Browser>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBrowser = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockCapture = vi.fn();

    // Setup connectBrowser mock
    vi.mocked(connectBrowser).mockResolvedValue(mockBrowser as Browser);

    client = new BrowserClient(0, createBrowserProfile());
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
    it("should throw when browser is not connected", async () => {
      const task = createTask();

      await expect(client.process(task)).rejects.toThrow("has no browser connection");
    });

    it("should process task successfully", async () => {
      await client.connect();
      const task = createTask();
      const expectedResult: CaptureResult = {
        task,
        status: captureStatus.success,
        pngPath: "/path/to/screenshot.png",
        htmlPath: "/path/to/page.html",
        captureProcessingTimeMs: 1000,
        timestamp: new Date().toISOString(),
        workerIndex: 0,
      };
      mockCapture.mockResolvedValue(expectedResult);

      const result = await client.process(task);

      expect(result.status).toBe(captureStatus.success);
      expect(mockCapture).toHaveBeenCalledWith(
        mockBrowser,
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
        // Use a short taskTotal so the test is fast; default is 90s.
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
      const w = new BrowserClient(3, createBrowserProfile());
      expect(w.index).toBe(3);
    });

    it("should expose logger", () => {
      expect(client.logger).toBeDefined();
    });
  });
});
