import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { CaptureConfig } from "../../src/config/index.js";
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
import { Worker } from "../../src/capture/worker.js";
import connectBrowser from "../../src/browser.js";

const createConfig = (): CaptureConfig => createTestCaptureConfig();

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureOptions: { png: true, jpeg: false, html: true },
  ...overrides,
});

describe("Worker", () => {
  let worker: Worker;
  let mockBrowser: Partial<Browser>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBrowser = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockCapture = vi.fn();

    // Setup connectBrowser mock
    vi.mocked(connectBrowser).mockResolvedValue(mockBrowser as Browser);

    worker = new Worker("worker-1", { browserURL: "http://chromium:9222" }, createConfig());
  });

  describe("connect", () => {
    it("should return true on successful connection", async () => {
      const result = await worker.connect();

      expect(result).toBe(true);
      expect(connectBrowser).toHaveBeenCalledWith({
        browserURL: "http://chromium:9222",
      });
    });

    it("should set status to idle on successful connection", async () => {
      await worker.connect();

      const info = worker.getInfo();
      expect(info.status).toBe("idle");
    });

    it("should return false on connection failure", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Connection failed"));

      const result = await worker.connect();

      expect(result).toBe(false);
    });

    it("should set status to error on connection failure", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Connection failed"));

      await worker.connect();

      const info = worker.getInfo();
      expect(info.status).toBe("error");
      expect(info.errorHistory).toHaveLength(1);
      expect(info.errorHistory[0]).toMatchObject({
        type: "connection",
        message: "Connection failed",
      });
      expect(info.errorHistory[0]?.task).toBeUndefined();
    });

    it("should increment error count on failure", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Error"));

      await worker.connect();

      const info = worker.getInfo();
      expect(info.errorCount).toBe(1);
    });
  });

  describe("disconnect", () => {
    it("should disconnect browser and set status to stopped", async () => {
      await worker.connect();
      await worker.disconnect();

      expect(mockBrowser.disconnect).toHaveBeenCalled();
      expect(worker.getInfo().status).toBe("stopped");
    });

    it("should handle disconnect when not connected", async () => {
      await worker.disconnect();

      expect(worker.getInfo().status).toBe("stopped");
    });

    it("should ignore disconnect errors", async () => {
      mockBrowser.disconnect = vi.fn().mockRejectedValue(new Error("Disconnect error"));
      await worker.connect();

      await expect(worker.disconnect()).resolves.not.toThrow();
      expect(worker.getInfo().status).toBe("stopped");
    });
  });

  describe("process", () => {
    it("should return failed result when worker is not available", async () => {
      const task = createTask();

      const result = await worker.process(task);

      expect(result.status).toBe(captureStatus.failed);
      expect(result.errorDetails?.message).toContain("not available");
      expect(result.workerId).toBe("worker-1");
    });

    it("should process task successfully", async () => {
      await worker.connect();
      const task = createTask();
      const expectedResult: CaptureResult = {
        task,
        status: captureStatus.success,
        pngPath: "/path/to/screenshot.png",
        htmlPath: "/path/to/page.html",
        captureProcessingTimeMs: 1000,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      };
      mockCapture.mockResolvedValue(expectedResult);

      const result = await worker.process(task);

      expect(result.status).toBe(captureStatus.success);
      expect(mockCapture).toHaveBeenCalledWith(
        mockBrowser,
        task,
        "worker-1"
      );
    });

    it("should increment processedCount on success", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.success,
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      expect(worker.getInfo().processedCount).toBe(1);
    });

    it("should increment errorCount on failure", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.failed,
        errorDetails: {
          type: "internal",
          message: "Capture failed",
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      expect(worker.getInfo().errorCount).toBe(1);
    });

    it("should add error to errorHistory on failure", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.failed,
        errorDetails: {
          type: "timeout",
          message: "Navigation timeout",
          timeoutMs: 30000,
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      const info = worker.getInfo();
      expect(info.errorHistory).toHaveLength(1);
      expect(info.errorHistory[0]).toMatchObject({
        type: "timeout",
        message: "Navigation timeout",
        timeoutMs: 30000,
      });
      expect(info.errorHistory[0]?.task).toEqual({
        taskId: task.taskId,
        url: task.url,
        labels: task.labels,
      });
    });

    it("should handle capture exception", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockRejectedValue(new Error("Unexpected error"));

      const result = await worker.process(task);

      expect(result.status).toBe(captureStatus.failed);
      expect(result.errorDetails?.message).toBe("Unexpected error");
      expect(worker.getInfo().errorCount).toBe(1);
    });

    it("should set status to error on disconnect-related error", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockRejectedValue(
        new Error("Target page, context or browser has been closed")
      );

      await worker.process(task);

      expect(worker.getInfo().status).toBe("error");
    });

    it("should set status back to idle after successful processing", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.success,
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      expect(worker.getInfo().status).toBe("idle");
    });
  });

  describe("isHealthy", () => {
    it("should return false when not connected", () => {
      expect(worker.isHealthy).toBe(false);
    });

    it("should return true when connected", async () => {
      await worker.connect();

      expect(worker.isHealthy).toBe(true);
    });

    it("should return false after disconnect", async () => {
      await worker.connect();
      await worker.disconnect();

      expect(worker.isHealthy).toBe(false);
    });

    it("should return false when in error state", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Error"));
      await worker.connect();

      expect(worker.isHealthy).toBe(false);
    });
  });

  describe("isIdle", () => {
    it("should return false when not connected", () => {
      expect(worker.isIdle).toBe(false);
    });

    it("should return true when connected and idle", async () => {
      await worker.connect();

      expect(worker.isIdle).toBe(true);
    });

    it("should return false when in error state", async () => {
      vi.mocked(connectBrowser).mockRejectedValue(new Error("Error"));
      await worker.connect();

      expect(worker.isIdle).toBe(false);
    });
  });

  describe("getInfo", () => {
    it("should return worker information", async () => {
      await worker.connect();

      const info = worker.getInfo();

      expect(info.id).toBe("worker-1");
      expect(info.browserOptions).toEqual({ browserURL: "http://chromium:9222" });
      expect(info.status).toBe("idle");
      expect(info.processedCount).toBe(0);
      expect(info.errorCount).toBe(0);
      expect(info.errorHistory).toEqual([]);
    });
  });

  describe("errorHistory", () => {
    it("should maintain FIFO order with newest first", async () => {
      await worker.connect();

      for (let i = 1; i <= 3; i++) {
        const task = createTask({ taskId: `task-${String(i)}` });
        mockCapture.mockResolvedValue({
          task,
          status: captureStatus.failed,
          errorDetails: {
            type: "internal",
            message: `Error ${String(i)}`,
          },
          captureProcessingTimeMs: 100,
          timestamp: new Date().toISOString(),
          workerId: "worker-1",
        });
        await worker.process(task);
      }

      const info = worker.getInfo();
      expect(info.errorHistory).toHaveLength(3);
      expect(info.errorHistory[0]?.message).toBe("Error 3");
      expect(info.errorHistory[2]?.message).toBe("Error 1");
    });

    it("should keep only last 10 errors", async () => {
      await worker.connect();

      for (let i = 1; i <= 12; i++) {
        const task = createTask({ taskId: `task-${String(i)}` });
        mockCapture.mockResolvedValue({
          task,
          status: captureStatus.failed,
          errorDetails: {
            type: "internal",
            message: `Error ${String(i)}`,
          },
          captureProcessingTimeMs: 100,
          timestamp: new Date().toISOString(),
          workerId: "worker-1",
        });
        await worker.process(task);
      }

      const info = worker.getInfo();
      expect(info.errorHistory).toHaveLength(10);
      expect(info.errorHistory[0]?.message).toBe("Error 12");
      expect(info.errorHistory[9]?.message).toBe("Error 3");
    });

    it("should include task info in error record", async () => {
      await worker.connect();
      const task = createTask({
        taskId: "test-task-123",
        url: "https://example.com/page",
        labels: ["TestPage"],
      });
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.failed,
        errorDetails: {
          type: "internal",
          message: "Page load failed",
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      const info = worker.getInfo();
      expect(info.errorHistory[0]?.task).toEqual({
        taskId: "test-task-123",
        url: "https://example.com/page",
        labels: ["TestPage"],
      });
    });

    it("should have ISO timestamp in error record", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.failed,
        errorDetails: {
          type: "internal",
          message: "Error",
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      const info = worker.getInfo();
      const timestamp = info.errorHistory[0]?.timestamp;
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it("should include HTTP error details in errorHistory", async () => {
      await worker.connect();
      const task = createTask();
      mockCapture.mockResolvedValue({
        task,
        status: captureStatus.httpError,
        httpStatusCode: 404,
        errorDetails: {
          type: "http",
          message: "HTTP 404: Not Found",
          httpStatusCode: 404,
          httpStatusText: "Not Found",
        },
        captureProcessingTimeMs: 100,
        timestamp: new Date().toISOString(),
        workerId: "worker-1",
      });

      await worker.process(task);

      const info = worker.getInfo();
      expect(info.errorHistory[0]).toMatchObject({
        type: "http",
        message: "HTTP 404: Not Found",
        httpStatusCode: 404,
        httpStatusText: "Not Found",
      });
    });
  });
});
