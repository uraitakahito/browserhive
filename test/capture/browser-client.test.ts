import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
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

vi.mock("../../src/capture/page-capturer.js", () => ({
  PageCapturer: vi.fn().mockImplementation(function PageCapturer() {
    return {
      capture: (...args: unknown[]) => mockCapture(...args),
    };
  }),
}));

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
  captureOptions: { png: true, jpeg: false, html: true },
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

    it("should propagate capture exceptions", async () => {
      await client.connect();
      const task = createTask();
      mockCapture.mockRejectedValue(new Error("Unexpected error"));

      await expect(client.process(task)).rejects.toThrow("Unexpected error");
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
