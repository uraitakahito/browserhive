import { describe, it, expect } from "vitest";
import {
  workerStatusToProto,
  errorTypeToProto,
  captureOptionsToProto,
  errorRecordToProto,
  workerInfoToProto,
  poolStatusToResponse,
} from "../../src/grpc/response-mapper.js";
import { WorkerStatus, ErrorType } from "../../src/grpc/generated/browserhive/v1/capture.js";
import type { CaptureOptions, ErrorRecord, WorkerInfo } from "../../src/capture/index.js";
import type { PoolStatus } from "../../src/capture/worker-pool.js";

describe("workerStatusToProto", () => {
  it("should convert idle to WORKER_STATUS_IDLE", () => {
    expect(workerStatusToProto("idle")).toBe(WorkerStatus.WORKER_STATUS_IDLE);
  });

  it("should convert busy to WORKER_STATUS_BUSY", () => {
    expect(workerStatusToProto("busy")).toBe(WorkerStatus.WORKER_STATUS_BUSY);
  });

  it("should convert error to WORKER_STATUS_ERROR", () => {
    expect(workerStatusToProto("error")).toBe(WorkerStatus.WORKER_STATUS_ERROR);
  });

  it("should convert stopped to WORKER_STATUS_STOPPED", () => {
    expect(workerStatusToProto("stopped")).toBe(WorkerStatus.WORKER_STATUS_STOPPED);
  });
});

describe("errorTypeToProto", () => {
  it("should convert http to ERROR_TYPE_HTTP", () => {
    expect(errorTypeToProto("http")).toBe(ErrorType.ERROR_TYPE_HTTP);
  });

  it("should convert timeout to ERROR_TYPE_TIMEOUT", () => {
    expect(errorTypeToProto("timeout")).toBe(ErrorType.ERROR_TYPE_TIMEOUT);
  });

  it("should convert connection to ERROR_TYPE_CONNECTION", () => {
    expect(errorTypeToProto("connection")).toBe(ErrorType.ERROR_TYPE_CONNECTION);
  });

  it("should convert internal to ERROR_TYPE_INTERNAL", () => {
    expect(errorTypeToProto("internal")).toBe(ErrorType.ERROR_TYPE_INTERNAL);
  });
});

describe("captureOptionsToProto", () => {
  it("should convert png-only options", () => {
    const options: CaptureOptions = { png: true, jpeg: false, html: false };
    const result = captureOptionsToProto(options);
    expect(result).toEqual({ png: true, jpeg: false, html: false });
  });

  it("should convert jpeg-only options", () => {
    const options: CaptureOptions = { png: false, jpeg: true, html: false };
    const result = captureOptionsToProto(options);
    expect(result).toEqual({ png: false, jpeg: true, html: false });
  });

  it("should convert html-only options", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: true };
    const result = captureOptionsToProto(options);
    expect(result).toEqual({ png: false, jpeg: false, html: true });
  });

  it("should convert all enabled options", () => {
    const options: CaptureOptions = { png: true, jpeg: true, html: true };
    const result = captureOptionsToProto(options);
    expect(result).toEqual({ png: true, jpeg: true, html: true });
  });

  it("should convert all disabled options", () => {
    const options: CaptureOptions = { png: false, jpeg: false, html: false };
    const result = captureOptionsToProto(options);
    expect(result).toEqual({ png: false, jpeg: false, html: false });
  });
});

describe("errorRecordToProto", () => {
  it("should convert minimal error record", () => {
    const record: ErrorRecord = {
      type: "connection",
      message: "Browser disconnected",
      timestamp: "2024-01-15T10:35:00.000Z",
    };

    const result = errorRecordToProto(record);

    expect(result).toEqual({
      type: ErrorType.ERROR_TYPE_CONNECTION,
      message: "Browser disconnected",
      timestamp: "2024-01-15T10:35:00.000Z",
    });
  });

  it("should include HTTP error fields when present", () => {
    const record: ErrorRecord = {
      type: "http",
      message: "HTTP 404: Not Found",
      httpStatusCode: 404,
      httpStatusText: "Not Found",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    const result = errorRecordToProto(record);

    expect(result).toEqual({
      type: ErrorType.ERROR_TYPE_HTTP,
      message: "HTTP 404: Not Found",
      http_status_code: 404,
      http_status_text: "Not Found",
      timestamp: "2024-01-15T10:30:00.000Z",
    });
  });

  it("should include timeout field when present", () => {
    const record: ErrorRecord = {
      type: "timeout",
      message: "Connection timeout",
      timeoutMs: 30000,
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    const result = errorRecordToProto(record);

    expect(result).toEqual({
      type: ErrorType.ERROR_TYPE_TIMEOUT,
      message: "Connection timeout",
      timeout_ms: 30000,
      timestamp: "2024-01-15T10:30:00.000Z",
    });
  });

  it("should include task info when present", () => {
    const record: ErrorRecord = {
      type: "timeout",
      message: "Connection timeout",
      timeoutMs: 30000,
      timestamp: "2024-01-15T10:30:00.000Z",
      task: {
        taskId: "task-123",
        url: "https://example.com",
        labels: ["Example"],
      },
    };

    const result = errorRecordToProto(record);

    expect(result.task).toEqual({
      task_id: "task-123",
      url: "https://example.com",
      labels: ["Example"],
    });
  });

  it("should omit optional fields when undefined", () => {
    const record: ErrorRecord = {
      type: "internal",
      message: "Unknown error",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    const result = errorRecordToProto(record);

    expect(result).not.toHaveProperty("http_status_code");
    expect(result).not.toHaveProperty("http_status_text");
    expect(result).not.toHaveProperty("timeout_ms");
    expect(result).not.toHaveProperty("task");
  });
});

describe("workerInfoToProto", () => {
  it("should convert worker info with empty error history", () => {
    const worker: WorkerInfo = {
      id: "worker-1",
      browserOptions: { browserURL: "http://browser1:9222" },
      status: "idle",
      processedCount: 5,
      errorCount: 0,
      errorHistory: [],
    };

    const result = workerInfoToProto(worker);

    expect(result).toEqual({
      id: "worker-1",
      browser_options: { browser_url: "http://browser1:9222" },
      status: WorkerStatus.WORKER_STATUS_IDLE,
      processed_count: 5,
      error_count: 0,
      error_history: [],
    });
  });

  it("should convert worker info with error history", () => {
    const worker: WorkerInfo = {
      id: "worker-2",
      browserOptions: { browserURL: "http://browser2:9222" },
      status: "busy",
      processedCount: 3,
      errorCount: 1,
      errorHistory: [
        {
          type: "timeout",
          message: "Connection timeout",
          timeoutMs: 30000,
          timestamp: "2024-01-15T10:30:00.000Z",
          task: {
            taskId: "task-123",
            url: "https://example.com",
            labels: ["Example"],
          },
        },
      ],
    };

    const result = workerInfoToProto(worker);

    expect(result.status).toBe(WorkerStatus.WORKER_STATUS_BUSY);
    expect(result.error_history).toHaveLength(1);
    expect(result.error_history[0]).toEqual({
      type: ErrorType.ERROR_TYPE_TIMEOUT,
      message: "Connection timeout",
      timeout_ms: 30000,
      timestamp: "2024-01-15T10:30:00.000Z",
      task: {
        task_id: "task-123",
        url: "https://example.com",
        labels: ["Example"],
      },
    });
  });
});

describe("poolStatusToResponse", () => {
  it("should convert full pool status to StatusResponse", () => {
    const status: PoolStatus = {
      taskCounts: { pending: 5, processing: 2, completed: 10 },
      healthyWorkers: 2,
      totalWorkers: 3,
      isRunning: true,
      workers: [
        {
          id: "worker-1",
          browserOptions: { browserURL: "http://browser1:9222" },
          status: "idle",
          processedCount: 5,
          errorCount: 0,
          errorHistory: [],
        },
        {
          id: "worker-2",
          browserOptions: { browserURL: "http://browser2:9222" },
          status: "error",
          processedCount: 2,
          errorCount: 2,
          errorHistory: [
            {
              type: "connection",
              message: "Browser disconnected",
              timestamp: "2024-01-15T10:35:00.000Z",
            },
          ],
        },
      ],
    };

    const response = poolStatusToResponse(status);

    expect(response.pending).toBe(5);
    expect(response.processing).toBe(2);
    expect(response.completed).toBe(10);
    expect(response.healthy_workers).toBe(2);
    expect(response.total_workers).toBe(3);
    expect(response.is_running).toBe(true);
    expect(response.workers).toHaveLength(2);
    expect(response.workers[0]!.status).toBe(WorkerStatus.WORKER_STATUS_IDLE);
    expect(response.workers[1]!.status).toBe(WorkerStatus.WORKER_STATUS_ERROR);
    expect(response.workers[1]!.error_history[0]).toEqual({
      type: ErrorType.ERROR_TYPE_CONNECTION,
      message: "Browser disconnected",
      timestamp: "2024-01-15T10:35:00.000Z",
    });
  });

  it("should convert empty pool status", () => {
    const status: PoolStatus = {
      taskCounts: { pending: 0, processing: 0, completed: 0 },
      healthyWorkers: 0,
      totalWorkers: 0,
      isRunning: false,
      workers: [],
    };

    const response = poolStatusToResponse(status);

    expect(response.pending).toBe(0);
    expect(response.is_running).toBe(false);
    expect(response.workers).toHaveLength(0);
  });
});
