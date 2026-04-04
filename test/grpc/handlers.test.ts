import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createCaptureServiceHandlers } from "../../src/grpc/handlers.js";
import type { CaptureCoordinator } from "../../src/capture/index.js";
import type { CaptureRequest, CaptureAcceptance, Empty, StatusResponse } from "../../src/grpc/generated/browserhive/v1/capture.js";
import { WorkerStatus, ErrorType } from "../../src/grpc/generated/browserhive/v1/capture.js";
import type * as grpc from "@grpc/grpc-js";

describe("createCaptureServiceHandlers", () => {
  let mockCaptureCoordinator: CaptureCoordinator;
  let handlers: ReturnType<typeof createCaptureServiceHandlers>;
  let mockCallback: Mock;
  let mockCall: { request: CaptureRequest };

  beforeEach(() => {
    mockCaptureCoordinator = {
      isRunning: true,
      operationalWorkerCount: 1,
      enqueueTask: vi.fn().mockReturnValue({ success: true }),
    } as unknown as CaptureCoordinator;

    handlers = createCaptureServiceHandlers(mockCaptureCoordinator);
    mockCallback = vi.fn();
  });

  const createMockCall = (request: Partial<CaptureRequest>): typeof mockCall => ({
    request: {
      url: "https://example.com",
      labels: ["Test"],
      capture_options: { png: true, jpeg: false, html: true },
      ...request,
    },
  });

  describe("submitCapture handler", () => {
    describe("validation errors", () => {
      it("should reject when url is missing", () => {
        mockCall = createMockCall({ url: "" });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: "url is required",
        });
      });

      it("should reject when url is whitespace only", () => {
        mockCall = createMockCall({ url: "   " });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: "url is required",
        });
      });

      it("should accept when labels is empty array", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");
        mockCall = createMockCall({ labels: [] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
          accepted: true,
          task_id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        }));
        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          labels: [],
        }));
      });

      it("should accept when labels contains only whitespace (treated as empty)", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");
        mockCall = createMockCall({ labels: ["   "] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
          accepted: true,
        }));
        // Whitespace-only labels should be filtered out
        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          labels: [],
        }));
      });

      it("should reject when any label contains invalid characters", () => {
        mockCall = createMockCall({ labels: ["Valid", "Test:Name"] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: expect.stringContaining("Invalid filename") as string,
        });
      });

      it("should reject when any label contains whitespace", () => {
        mockCall = createMockCall({ labels: ["Valid", "Test Name"] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: expect.stringContaining("whitespace") as string,
        });
      });

      it("should reject when correlation_id contains invalid characters", () => {
        mockCall = createMockCall({ labels: ["ValidName"], correlation_id: "ext/id" });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: expect.stringContaining("Invalid filename") as string,
        });
      });

      it("should reject when capture_options is undefined", () => {
        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["Test"],
          capture_options: undefined,
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: "At least one capture option must be enabled (png, jpeg, or html)",
        });
      });

      it("should reject when all capture_options flags are false", () => {
        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["Test"],
          capture_options: { png: false, jpeg: false, html: false },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: "At least one capture option must be enabled (png, jpeg, or html)",
        });
      });

      it("should reject when any label exceeds 100 characters", () => {
        mockCall = createMockCall({ labels: ["Valid", "a".repeat(101)] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: expect.stringContaining("exceeds") as string,
        });
      });
    });

    describe("worker pool unavailable", () => {
      it("should return error when worker pool is not running", () => {
        mockCaptureCoordinator = {
          isRunning: false,
          operationalWorkerCount: 1,
          enqueueTask: vi.fn(),
        } as unknown as CaptureCoordinator;
        handlers = createCaptureServiceHandlers(mockCaptureCoordinator);

        mockCall = createMockCall({});

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith({
          code: 14, // UNAVAILABLE
          message: "No operational workers available",
        });
      });

      it("should return error when no healthy workers", () => {
        mockCaptureCoordinator = {
          isRunning: true,
          operationalWorkerCount: 0,
          enqueueTask: vi.fn(),
        } as unknown as CaptureCoordinator;
        handlers = createCaptureServiceHandlers(mockCaptureCoordinator);

        mockCall = createMockCall({});

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith({
          code: 14, // UNAVAILABLE
          message: "No operational workers available",
        });
      });
    });

    describe("successful request", () => {
      it("should accept valid request and return task_id", () => {
        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["TestPage"],
          capture_options: { png: true, jpeg: false, html: false },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
          accepted: true,
          task_id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        }));
      });

      it("should accept multiple valid labels", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");

        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["cat", "subcat", "tag"],
          capture_options: { png: true, jpeg: false, html: false },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
          accepted: true,
        }));
        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          labels: ["cat", "subcat", "tag"],
        }));
      });

      it("should include correlation_id in response when provided", () => {
        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["TestPage"],
          capture_options: { png: true, jpeg: false, html: true },
          correlation_id: "ext-123",
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
          accepted: true,
          correlation_id: "ext-123",
        }));
      });

      it("should enqueue task with png-only options", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");

        mockCall = createMockCall({
          url: "https://example.com/page",
          labels: ["MyPage"],
          capture_options: { png: true, jpeg: false, html: false },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          url: "https://example.com/page",
          labels: ["MyPage"],
          captureOptions: { png: true, jpeg: false, html: false },
          retryCount: 0,
          taskId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        }));
      });

      it("should enqueue task with html-only options", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");

        mockCall = createMockCall({
          url: "https://example.com/page",
          labels: ["MyPage"],
          capture_options: { png: false, jpeg: false, html: true },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          captureOptions: { png: false, jpeg: false, html: true },
        }));
      });

      it("should trim url and labels", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");

        mockCall = createMockCall({
          url: "  https://example.com  ",
          labels: ["  TestName  ", "  Category  "],
          capture_options: { png: true, jpeg: false, html: true },
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          url: "https://example.com",
          labels: ["TestName", "Category"],
        }));
      });

      it("should reject duplicate URL when enqueueTask returns failure", () => {
        mockCaptureCoordinator = {
          isRunning: true,
          operationalWorkerCount: 1,
          enqueueTask: vi.fn().mockReturnValue({
            success: false,
            error: "URL already in queue: https://example.com",
          }),
        } as unknown as CaptureCoordinator;

        handlers = createCaptureServiceHandlers(mockCaptureCoordinator);
        mockCall = createMockCall({ url: "https://example.com", labels: ["Test"] });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(mockCallback).toHaveBeenCalledWith(null, {
          accepted: false,
          task_id: "",
          error: "URL already in queue: https://example.com",
        });
      });

      it("should include correlationId in task when provided", () => {
        const enqueueTaskSpy = vi.spyOn(mockCaptureCoordinator, "enqueueTask");

        mockCall = createMockCall({
          url: "https://example.com",
          labels: ["Test"],
          capture_options: { png: true, jpeg: false, html: false },
          correlation_id: "client-id-456",
        });

        handlers.submitCapture(
          mockCall as unknown as grpc.ServerUnaryCall<CaptureRequest, CaptureAcceptance>,
          mockCallback as unknown as grpc.sendUnaryData<CaptureAcceptance>
        );

        expect(enqueueTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
          correlationId: "client-id-456",
        }));
      });
    });
  });

  describe("getStatus handler", () => {
    it("should return current queue and worker pool status with worker details", () => {
      mockCaptureCoordinator = {
        isRunning: true,
        operationalWorkerCount: 2,
        enqueueTask: vi.fn(),
        getStatus: vi.fn().mockReturnValue({
          taskCounts: {
            pending: 5,
            processing: 2,
            completed: 10,
          },
          operationalWorkers: 2,
          totalWorkers: 3,
          isRunning: true,
          workers: [
            {
              index: 0,
              browserProfile: { browserURL: "http://browser1:9222" },
              status: "ready",
              processedCount: 5,
              errorCount: 0,
              errorHistory: [],
            },
            {
              index: 1,
              browserProfile: { browserURL: "http://browser2:9222" },
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
            },
            {
              index: 2,
              browserProfile: { browserURL: "http://browser3:9222" },
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
        }),
      } as unknown as CaptureCoordinator;

      handlers = createCaptureServiceHandlers(mockCaptureCoordinator);

      handlers.getStatus(
        {} as grpc.ServerUnaryCall<Empty, StatusResponse>,
        mockCallback as unknown as grpc.sendUnaryData<StatusResponse>
      );

      expect(mockCallback).toHaveBeenCalledWith(null, {
        pending: 5,
        processing: 2,
        completed: 10,
        operational_workers: 2,
        total_workers: 3,
        is_running: true,
        workers: [
          {
            index: 0,
            browser_options: { browser_url: "http://browser1:9222" },
            status: WorkerStatus.WORKER_STATUS_READY,
            processed_count: 5,
            error_count: 0,
            error_history: [],
          },
          {
            index: 1,
            browser_options: { browser_url: "http://browser2:9222" },
            status: WorkerStatus.WORKER_STATUS_BUSY,
            processed_count: 3,
            error_count: 1,
            error_history: [
              {
                type: ErrorType.ERROR_TYPE_TIMEOUT,
                message: "Connection timeout",
                timeout_ms: 30000,
                timestamp: "2024-01-15T10:30:00.000Z",
                task: {
                  task_id: "task-123",
                  url: "https://example.com",
                  labels: ["Example"],
                },
              },
            ],
          },
          {
            index: 2,
            browser_options: { browser_url: "http://browser3:9222" },
            status: WorkerStatus.WORKER_STATUS_ERROR,
            processed_count: 2,
            error_count: 2,
            error_history: [
              {
                type: ErrorType.ERROR_TYPE_CONNECTION,
                message: "Browser disconnected",
                timestamp: "2024-01-15T10:35:00.000Z",
              },
            ],
          },
        ],
      });
    });

    it("should return status even when pool is not running", () => {
      mockCaptureCoordinator = {
        isRunning: false,
        operationalWorkerCount: 0,
        enqueueTask: vi.fn(),
        getStatus: vi.fn().mockReturnValue({
          taskCounts: {
            pending: 0,
            processing: 0,
            completed: 0,
          },
          operationalWorkers: 0,
          totalWorkers: 2,
          isRunning: false,
          workers: [
            {
              index: 0,
              browserProfile: { browserURL: "http://browser1:9222" },
              status: "stopped",
              processedCount: 0,
              errorCount: 0,
              errorHistory: [],
            },
            {
              index: 1,
              browserProfile: { browserURL: "http://browser2:9222" },
              status: "stopped",
              processedCount: 0,
              errorCount: 0,
              errorHistory: [],
            },
          ],
        }),
      } as unknown as CaptureCoordinator;

      handlers = createCaptureServiceHandlers(mockCaptureCoordinator);

      handlers.getStatus(
        {} as grpc.ServerUnaryCall<Empty, StatusResponse>,
        mockCallback as unknown as grpc.sendUnaryData<StatusResponse>
      );

      expect(mockCallback).toHaveBeenCalledWith(null, {
        pending: 0,
        processing: 0,
        completed: 0,
        operational_workers: 0,
        total_workers: 2,
        is_running: false,
        workers: [
          {
            index: 0,
            browser_options: { browser_url: "http://browser1:9222" },
            status: WorkerStatus.WORKER_STATUS_STOPPED,
            processed_count: 0,
            error_count: 0,
            error_history: [],
          },
          {
            index: 1,
            browser_options: { browser_url: "http://browser2:9222" },
            status: WorkerStatus.WORKER_STATUS_STOPPED,
            processed_count: 0,
            error_count: 0,
            error_history: [],
          },
        ],
      });
    });
  });
});
