import { describe, it, expect } from "vitest";
import {
  coordinatorStatusToResponse,
  errorRecordToWire,
  taskToAcceptance,
  workerInfoToWire,
} from "../../src/http/response-mapper.js";
import type {
  CaptureTask,
  ErrorRecord,
  WorkerInfo,
} from "../../src/capture/index.js";
import type { CoordinatorStatusReport } from "../../src/capture/capture-coordinator.js";
import { createTestBrowserProfile } from "../helpers/config.js";

describe("taskToAcceptance", () => {
  it("includes correlationId when present", () => {
    const task: CaptureTask = {
      taskId: "task-1",
      labels: [],
      url: "https://example.com",
      retryCount: 0,
      captureFormats: { png: true, jpeg: false, html: false },
      dismissBanners: false,
      correlationId: "EXT-1",
    };
    expect(taskToAcceptance(task)).toEqual({
      accepted: true,
      taskId: "task-1",
      correlationId: "EXT-1",
    });
  });

  it("omits correlationId when absent", () => {
    const task: CaptureTask = {
      taskId: "task-2",
      labels: [],
      url: "https://example.com",
      retryCount: 0,
      captureFormats: { png: true, jpeg: false, html: false },
      dismissBanners: false,
    };
    expect(taskToAcceptance(task)).toEqual({
      accepted: true,
      taskId: "task-2",
    });
  });
});

describe("errorRecordToWire", () => {
  it("emits only optional fields that are present", () => {
    const record: ErrorRecord = {
      type: "http",
      message: "HTTP 404",
      timestamp: "2024-01-01T00:00:00.000Z",
      httpStatusCode: 404,
      httpStatusText: "Not Found",
      task: { taskId: "t-1", url: "https://example.com", labels: ["a"] },
    };
    expect(errorRecordToWire(record)).toEqual({
      type: "http",
      message: "HTTP 404",
      timestamp: "2024-01-01T00:00:00.000Z",
      httpStatusCode: 404,
      httpStatusText: "Not Found",
      task: { taskId: "t-1", url: "https://example.com", labels: ["a"] },
    });
  });

  it("excludes empty optional keys", () => {
    const record: ErrorRecord = {
      type: "internal",
      message: "boom",
      timestamp: "2024-01-01T00:00:00.000Z",
    };
    const wire = errorRecordToWire(record);
    expect(Object.keys(wire).sort()).toEqual(["message", "timestamp", "type"]);
  });
});

describe("workerInfoToWire and coordinatorStatusToResponse", () => {
  it("renames browserURL to browserUrl in BrowserOptions", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const worker: WorkerInfo = {
      index: 0,
      browserProfile: profile,
      health: "ready",
      processedCount: 3,
      errorCount: 1,
      errorHistory: [],
    };
    expect(workerInfoToWire(worker).browserOptions).toEqual({
      browserUrl: "http://chromium-1:9222",
    });
  });

  it("converts CoordinatorStatusReport into the OpenAPI shape", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const report: CoordinatorStatusReport = {
      taskCounts: { pending: 2, processing: 1, completed: 5 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [
        {
          index: 0,
          browserProfile: profile,
          health: "busy",
          processedCount: 5,
          errorCount: 0,
          errorHistory: [],
        },
      ],
    };
    const response = coordinatorStatusToResponse(report);
    expect(response.pending).toBe(2);
    expect(response.processing).toBe(1);
    expect(response.completed).toBe(5);
    expect(response.operationalWorkers).toBe(1);
    expect(response.isRunning).toBe(true);
    expect(response.isDegraded).toBe(false);
    expect(response.workers).toHaveLength(1);
    expect(response.workers[0]?.health).toBe("busy");
  });
});
