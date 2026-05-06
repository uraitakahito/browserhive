import { describe, it, expect } from "vitest";
import {
  coordinatorStatusToResponse,
  currentTaskToWire,
  errorRecordToWire,
  taskToAcceptance,
  taskToPending,
  taskToProcessing,
  workerInfoToWire,
} from "../../src/http/response-mapper.js";
import type {
  CaptureTask,
  CurrentTaskInfo,
  ErrorRecord,
  WorkerInfo,
} from "../../src/capture/index.js";
import type {
  CoordinatorStatusReport,
  ProcessingTaskView,
} from "../../src/capture/capture-coordinator.js";
import { createTestBrowserProfile } from "../helpers/config.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

describe("taskToAcceptance", () => {
  it("includes correlationId when present", () => {
    const task: CaptureTask = {
      taskId: "task-1",
      labels: [],
      url: "https://example.com",
      retryCount: 0,
      captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
      resetState: DEFAULT_RESET_STATE_OPTIONS,
      correlationId: "EXT-1",
      enqueuedAt: "2024-01-01T00:00:00.000Z",
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
      captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
      resetState: DEFAULT_RESET_STATE_OPTIONS,
      enqueuedAt: "2024-01-01T00:00:00.000Z",
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

  it("omits currentTask when the worker is idle", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const worker: WorkerInfo = {
      index: 0,
      browserProfile: profile,
      health: "ready",
      processedCount: 3,
      errorCount: 1,
      errorHistory: [],
    };
    const wire = workerInfoToWire(worker);
    expect(wire.currentTask).toBeUndefined();
    expect(Object.keys(wire)).not.toContain("currentTask");
  });

  it("emits currentTask with elapsedMs computed from `now` on busy workers", () => {
    const startedAt = "2024-01-01T00:00:00.000Z";
    const now = new Date("2024-01-01T00:00:30.500Z").getTime();
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const worker: WorkerInfo = {
      index: 0,
      browserProfile: profile,
      health: "busy",
      processedCount: 0,
      errorCount: 0,
      errorHistory: [],
      currentTask: {
        startedAt,
        task: {
          taskId: "t-1",
          labels: ["a"],
          url: "https://example.com",
          retryCount: 1,
          captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
          resetState: DEFAULT_RESET_STATE_OPTIONS,
              correlationId: "EXT-9",
          enqueuedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    };
    const wire = workerInfoToWire(worker, now);
    expect(wire.currentTask).toEqual({
      taskId: "t-1",
      url: "https://example.com",
      labels: ["a"],
      correlationId: "EXT-9",
      startedAt,
      elapsedMs: 30500,
      retryCount: 1,
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
      pendingTasks: [],
      processingTasks: [],
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
    expect(response.queue.pendingTasks).toEqual([]);
  });

  it("propagates currentTask from coordinator status to wire", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const report: CoordinatorStatusReport = {
      taskCounts: { pending: 0, processing: 1, completed: 0 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [
        {
          index: 0,
          browserProfile: profile,
          health: "busy",
          processedCount: 0,
          errorCount: 0,
          errorHistory: [],
          currentTask: {
            startedAt,
            task: {
              taskId: "t-busy",
              labels: [],
              url: "https://example.com/slow",
              retryCount: 0,
              captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
              resetState: DEFAULT_RESET_STATE_OPTIONS,
                      enqueuedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        },
      ],
      pendingTasks: [],
      processingTasks: [],
    };
    const response = coordinatorStatusToResponse(report);
    const wireCurrent = response.workers[0]?.currentTask;
    expect(wireCurrent?.taskId).toBe("t-busy");
    expect(wireCurrent?.url).toBe("https://example.com/slow");
    expect(wireCurrent?.startedAt).toBe(startedAt);
    // ~5000ms since startedAt; allow some slack for the test's wall clock
    expect(wireCurrent?.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(wireCurrent?.elapsedMs).toBeLessThan(6_000);
    // correlationId omitted upstream → omitted on wire too
    expect(wireCurrent?.correlationId).toBeUndefined();
  });
});

describe("currentTaskToWire", () => {
  const startedAt = "2024-01-01T00:00:00.000Z";
  const baseTask: CaptureTask = {
    taskId: "t-1",
    labels: ["a"],
    url: "https://example.com",
    retryCount: 0,
    captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
    resetState: DEFAULT_RESET_STATE_OPTIONS,
    enqueuedAt: "2024-01-01T00:00:00.000Z",
  };

  it("clamps elapsedMs to 0 when `now` precedes startedAt (clock skew safety)", () => {
    const current: CurrentTaskInfo = { task: baseTask, startedAt };
    const skewed = new Date(startedAt).getTime() - 1_000;
    const wire = currentTaskToWire(current, skewed);
    expect(wire.elapsedMs).toBe(0);
  });

  it("omits correlationId when the task has none", () => {
    const current: CurrentTaskInfo = { task: baseTask, startedAt };
    const wire = currentTaskToWire(current, new Date(startedAt).getTime());
    expect(Object.keys(wire)).not.toContain("correlationId");
  });
});

describe("taskToPending", () => {
  const enqueuedAt = "2024-01-01T00:00:00.000Z";
  const baseTask: CaptureTask = {
    taskId: "p-1",
    labels: ["x"],
    url: "https://example.com/p",
    retryCount: 2,
    captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
    resetState: DEFAULT_RESET_STATE_OPTIONS,
    enqueuedAt,
  };

  it("computes queuedMs from now and includes retryCount", () => {
    const now = new Date(enqueuedAt).getTime() + 12_345;
    const wire = taskToPending(baseTask, now);
    expect(wire).toEqual({
      taskId: "p-1",
      url: "https://example.com/p",
      labels: ["x"],
      enqueuedAt,
      queuedMs: 12_345,
      retryCount: 2,
    });
  });

  it("clamps queuedMs to 0 when now precedes enqueuedAt", () => {
    const skewed = new Date(enqueuedAt).getTime() - 5_000;
    const wire = taskToPending(baseTask, skewed);
    expect(wire.queuedMs).toBe(0);
  });

  it("includes correlationId when present on the task", () => {
    const wire = taskToPending(
      { ...baseTask, correlationId: "EXT-3" },
      new Date(enqueuedAt).getTime(),
    );
    expect(wire.correlationId).toBe("EXT-3");
  });
});

describe("taskToProcessing", () => {
  const enqueuedAt = "2024-01-01T00:00:00.000Z";
  const startedAt = "2024-01-01T00:00:10.000Z";
  const baseView: ProcessingTaskView = {
    workerIndex: 2,
    startedAt,
    task: {
      taskId: "proc-1",
      labels: ["L"],
      url: "https://example.com/p",
      retryCount: 0,
      captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
      resetState: DEFAULT_RESET_STATE_OPTIONS,
      enqueuedAt,
    },
  };

  it("emits queuedMs and elapsedMs from the same `now` snapshot", () => {
    const now = new Date(startedAt).getTime() + 7_000;
    const wire = taskToProcessing(baseView, now);
    expect(wire).toEqual({
      taskId: "proc-1",
      url: "https://example.com/p",
      labels: ["L"],
      enqueuedAt,
      queuedMs: now - new Date(enqueuedAt).getTime(),
      retryCount: 0,
      workerIndex: 2,
      startedAt,
      elapsedMs: 7_000,
    });
  });

  it("clamps both elapsedMs and queuedMs to 0 on backward clock skew", () => {
    const skewed = new Date(enqueuedAt).getTime() - 1_000;
    const wire = taskToProcessing(baseView, skewed);
    expect(wire.elapsedMs).toBe(0);
    expect(wire.queuedMs).toBe(0);
  });

  it("includes correlationId when present on the underlying task", () => {
    const wire = taskToProcessing(
      { ...baseView, task: { ...baseView.task, correlationId: "C-1" } },
      new Date(startedAt).getTime(),
    );
    expect(wire.correlationId).toBe("C-1");
  });
});

describe("coordinatorStatusToResponse — queue.pendingTasks", () => {
  it("propagates pendingTasks to wire with computed queuedMs", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const enqueuedAt = new Date(Date.now() - 3_000).toISOString();
    const report: CoordinatorStatusReport = {
      taskCounts: { pending: 1, processing: 0, completed: 0 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [
        {
          index: 0,
          browserProfile: profile,
          health: "ready",
          processedCount: 0,
          errorCount: 0,
          errorHistory: [],
        },
      ],
      pendingTasks: [
        {
          taskId: "p-1",
          labels: [],
          url: "https://example.com/queued",
          retryCount: 0,
          captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
          resetState: DEFAULT_RESET_STATE_OPTIONS,
          enqueuedAt,
        },
      ],
      processingTasks: [],
    };
    const response = coordinatorStatusToResponse(report);
    expect(response.queue.pendingTasks).toHaveLength(1);
    const head = response.queue.pendingTasks[0];
    expect(head?.taskId).toBe("p-1");
    expect(head?.enqueuedAt).toBe(enqueuedAt);
    expect(head?.queuedMs).toBeGreaterThanOrEqual(3_000);
    expect(head?.queuedMs).toBeLessThan(4_000);
  });

  it("propagates processingTasks (worker-aggregated) to wire", () => {
    const profile = createTestBrowserProfile("http://chromium-1:9222");
    const enqueuedAt = new Date(Date.now() - 8_000).toISOString();
    const startedAt = new Date(Date.now() - 4_000).toISOString();
    const report: CoordinatorStatusReport = {
      taskCounts: { pending: 0, processing: 1, completed: 0 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [
        {
          index: 0,
          browserProfile: profile,
          health: "busy",
          processedCount: 0,
          errorCount: 0,
          errorHistory: [],
        },
      ],
      pendingTasks: [],
      processingTasks: [
        {
          workerIndex: 0,
          startedAt,
          task: {
            taskId: "running-1",
            labels: ["x"],
            url: "https://example.com/running",
            retryCount: 1,
            captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
            resetState: DEFAULT_RESET_STATE_OPTIONS,
            enqueuedAt,
          },
        },
      ],
    };
    const response = coordinatorStatusToResponse(report);
    expect(response.queue.processingTasks).toHaveLength(1);
    const wire = response.queue.processingTasks[0];
    expect(wire?.taskId).toBe("running-1");
    expect(wire?.workerIndex).toBe(0);
    expect(wire?.startedAt).toBe(startedAt);
    expect(wire?.enqueuedAt).toBe(enqueuedAt);
    // elapsedMs ≈ 4s, queuedMs ≈ 8s — same response-level `now`
    expect(wire?.elapsedMs).toBeGreaterThanOrEqual(4_000);
    expect(wire?.elapsedMs).toBeLessThan(5_000);
    expect(wire?.queuedMs).toBeGreaterThanOrEqual(8_000);
    expect(wire?.queuedMs).toBeLessThan(9_000);
    expect(wire?.retryCount).toBe(1);
  });
});
