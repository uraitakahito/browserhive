import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createCaptureHandlers } from "../../src/http/handlers.js";
import type { CaptureCoordinator } from "../../src/capture/index.js";
import type { CoordinatorStatusReport } from "../../src/capture/capture-coordinator.js";
import { ok, err } from "../../src/result.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";
import { DEFAULT_CAPTURE_CONFIG } from "../../src/config/index.js";
import type { CaptureConfig } from "../../src/config/index.js";

interface CoordinatorStub {
  isActive: boolean;
  operationalWorkerCount: number;
  enqueueTask: ReturnType<typeof vi.fn>;
  getStatus: (opts?: { pendingLimit?: number }) => CoordinatorStatusReport;
  captureDefaults: CaptureConfig;
}

const buildStub = (overrides: Partial<CoordinatorStub> = {}): CoordinatorStub => ({
  isActive: true,
  operationalWorkerCount: 1,
  enqueueTask: vi.fn().mockReturnValue(ok()),
  // The handler reads `coordinator.captureDefaults` once at construction
  // time and forwards `resetPageState` into the request mapper. Providing
  // the built-in defaults here keeps these existing tests focused on
  // status / 4xx / 5xx behaviour without dragging resetState into them.
  captureDefaults: DEFAULT_CAPTURE_CONFIG,
  getStatus: (): CoordinatorStatusReport => ({
    taskCounts: { pending: 0, processing: 0, completed: 0 },
    operationalWorkers: 1,
    totalWorkers: 1,
    isRunning: true,
    isDegraded: false,
    workers: [],
    pendingTasks: [],
    processingTasks: [],
  }),
  ...overrides,
});

const buildApp = (stub: CoordinatorStub): FastifyInstance => {
  const app = Fastify({ logger: false });
  const handlers = createCaptureHandlers(stub as unknown as CaptureCoordinator);
  app.post("/v1/captures", handlers.submitCapture);
  app.get("/v1/status", handlers.getStatus);
  return app;
};

const validBody = {
  url: "https://example.com",
  labels: ["my-label"],
  captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
};

describe("submitCapture handler", () => {
  let stub: CoordinatorStub;
  let app: FastifyInstance;

  beforeEach(() => {
    stub = buildStub();
    app = buildApp(stub);
  });

  it("returns 202 with CaptureAcceptance on success", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: validBody,
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<{ accepted: boolean; taskId: string }>();
    expect(body.accepted).toBe(true);
    expect(body.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stub.enqueueTask).toHaveBeenCalledTimes(1);
  });

  it("echoes correlationId when provided", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: { ...validBody, correlationId: "EXT-42" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json<{ correlationId?: string }>().correlationId).toBe(
      "EXT-42",
    );
  });

  it("returns 400 problem on validation failure", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: {
        ...validBody,
        captureFormats: { png: false, jpeg: false, html: false, links: false, pdf: false },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    const body = response.json<{ status: number; title: string }>();
    expect(body.status).toBe(400);
    expect(body.title).toBe("Validation failed");
    expect(stub.enqueueTask).not.toHaveBeenCalled();
  });

  it("returns 409 problem when enqueue rejects duplicate URL", async () => {
    stub.enqueueTask.mockReturnValue(err("URL already in queue: https://example.com"));
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: validBody,
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("returns 503 when coordinator is not active", async () => {
    stub.isActive = false;
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: validBody,
    });
    expect(response.statusCode).toBe(503);
    expect(stub.enqueueTask).not.toHaveBeenCalled();
  });

  it("returns 503 when there are no operational workers", async () => {
    stub.operationalWorkerCount = 0;
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: validBody,
    });
    expect(response.statusCode).toBe(503);
  });

  describe("resetState → forwarded to coordinator.enqueueTask", () => {
    it("uses captureDefaults.resetPageState when the request omits resetState", async () => {
      // Server-wide policy: cookies on, pageContext off.
      stub.captureDefaults = {
        ...DEFAULT_CAPTURE_CONFIG,
        resetPageState: { cookies: true, pageContext: false },
      };
      // captureDefaults is read inside createCaptureHandlers → re-build app.
      app = buildApp(stub);

      const response = await app.inject({
        method: "POST",
        url: "/v1/captures",
        payload: validBody,
      });

      expect(response.statusCode).toBe(202);
      const enqueued = stub.enqueueTask.mock.calls[0]?.[0] as
        | { resetState?: { cookies?: boolean; pageContext?: boolean } }
        | undefined;
      expect(enqueued?.resetState).toEqual({
        cookies: true,
        pageContext: false,
      });
    });

    it("per-request resetState: false overrides server defaults", async () => {
      // Even with the strictest server policy (full wipe), a request can
      // turn the wipe off entirely.
      stub.captureDefaults = DEFAULT_CAPTURE_CONFIG;
      app = buildApp(stub);

      const response = await app.inject({
        method: "POST",
        url: "/v1/captures",
        payload: { ...validBody, resetState: false },
      });

      expect(response.statusCode).toBe(202);
      const enqueued = stub.enqueueTask.mock.calls[0]?.[0] as
        | { resetState?: { cookies?: boolean; pageContext?: boolean } }
        | undefined;
      expect(enqueued?.resetState).toEqual({
        cookies: false,
        pageContext: false,
      });
    });

    it("per-request resetState object merges per-axis with server defaults", async () => {
      // Server: keep cookies, wipe pageContext. Request: flip cookies off
      // (no pageContext field) → result respects both: cookies=false from
      // request, pageContext=true from server.
      stub.captureDefaults = {
        ...DEFAULT_CAPTURE_CONFIG,
        resetPageState: { cookies: true, pageContext: true },
      };
      app = buildApp(stub);

      const response = await app.inject({
        method: "POST",
        url: "/v1/captures",
        payload: { ...validBody, resetState: { cookies: false } },
      });

      expect(response.statusCode).toBe(202);
      const enqueued = stub.enqueueTask.mock.calls[0]?.[0] as
        | { resetState?: { cookies?: boolean; pageContext?: boolean } }
        | undefined;
      expect(enqueued?.resetState).toEqual({
        cookies: false,
        pageContext: true,
      });
    });
  });
});

describe("getStatus handler", () => {
  it("returns 200 with the coordinator status", async () => {
    const stub = buildStub({
      getStatus: (): CoordinatorStatusReport => ({
        taskCounts: { pending: 5, processing: 2, completed: 10 },
        operationalWorkers: 2,
        totalWorkers: 2,
        isRunning: true,
        isDegraded: false,
        workers: [],
        pendingTasks: [],
        processingTasks: [],
      }),
    });
    const app = buildApp(stub);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ pending: number; isRunning: boolean }>();
    expect(body.pending).toBe(5);
    expect(body.isRunning).toBe(true);
  });

  it("forwards ?pendingLimit to coordinator.getStatus", async () => {
    const getStatus = vi.fn().mockReturnValue({
      taskCounts: { pending: 0, processing: 0, completed: 0 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [],
      pendingTasks: [],
      processingTasks: [],
    });
    const stub = buildStub({ getStatus });
    const app = buildApp(stub);
    const response = await app.inject({
      method: "GET",
      url: "/v1/status?pendingLimit=10",
    });
    expect(response.statusCode).toBe(200);
    // Without an Ajv-driven schema in this stub setup, the query value
    // arrives as a string. The handler still forwards it; coordinator
    // backstop normalizes via `?? DEFAULT_PENDING_TASKS_LIMIT` for missing
    // values. Schema-level coercion is exercised through the real server
    // wiring.
    expect(getStatus).toHaveBeenCalledTimes(1);
    const arg = getStatus.mock.calls[0]?.[0] as { pendingLimit?: unknown } | undefined;
    expect(arg?.pendingLimit).toBeDefined();
  });

  it("omits pendingLimit when the query is absent", async () => {
    const getStatus = vi.fn().mockReturnValue({
      taskCounts: { pending: 0, processing: 0, completed: 0 },
      operationalWorkers: 1,
      totalWorkers: 1,
      isRunning: true,
      isDegraded: false,
      workers: [],
      pendingTasks: [],
      processingTasks: [],
    });
    const stub = buildStub({ getStatus });
    const app = buildApp(stub);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    expect(getStatus).toHaveBeenCalledWith({});
  });

  it("includes currentTask on busy workers", async () => {
    const startedAt = new Date(Date.now() - 2_000).toISOString();
    const stub = buildStub({
      getStatus: (): CoordinatorStatusReport => ({
        taskCounts: { pending: 0, processing: 1, completed: 0 },
        operationalWorkers: 1,
        totalWorkers: 1,
        isRunning: true,
        isDegraded: false,
        workers: [
          {
            index: 0,
            browserProfile: {
              browserURL: "http://chromium-1:9222",
              capture: {
                timeouts: { pageLoad: 30000, capture: 10000, taskTotal: 90000 },
                viewport: { width: 1280, height: 800 },
                screenshot: { fullPage: false },
                resetPageState: { cookies: true, pageContext: true },
              },
            },
            health: "busy",
            processedCount: 0,
            errorCount: 0,
            errorHistory: [],
            currentTask: {
              startedAt,
              task: {
                taskId: "t-busy",
                labels: ["x"],
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
      }),
    });
    const app = buildApp(stub);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      workers: { currentTask?: { taskId: string; elapsedMs: number; startedAt: string } }[];
    }>();
    const cur = body.workers[0]?.currentTask;
    expect(cur?.taskId).toBe("t-busy");
    expect(cur?.startedAt).toBe(startedAt);
    expect(cur?.elapsedMs).toBeGreaterThanOrEqual(2_000);
  });

  it("emits queue.processingTasks for busy workers", async () => {
    const enqueuedAt = new Date(Date.now() - 6_000).toISOString();
    const startedAt = new Date(Date.now() - 1_500).toISOString();
    const stub = buildStub({
      getStatus: (): CoordinatorStatusReport => ({
        taskCounts: { pending: 0, processing: 1, completed: 0 },
        operationalWorkers: 1,
        totalWorkers: 1,
        isRunning: true,
        isDegraded: false,
        workers: [],
        pendingTasks: [],
        processingTasks: [
          {
            workerIndex: 0,
            startedAt,
            task: {
              taskId: "running-1",
              labels: [],
              url: "https://example.com/running",
              retryCount: 0,
              captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
              resetState: DEFAULT_RESET_STATE_OPTIONS,
              enqueuedAt,
            },
          },
        ],
      }),
    });
    const app = buildApp(stub);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      queue: {
        processingTasks: {
          taskId: string;
          workerIndex: number;
          startedAt: string;
          elapsedMs: number;
        }[];
      };
    }>();
    expect(body.queue.processingTasks).toHaveLength(1);
    const proc = body.queue.processingTasks[0];
    expect(proc?.taskId).toBe("running-1");
    expect(proc?.workerIndex).toBe(0);
    expect(proc?.startedAt).toBe(startedAt);
    expect(proc?.elapsedMs).toBeGreaterThanOrEqual(1_500);
  });
});
