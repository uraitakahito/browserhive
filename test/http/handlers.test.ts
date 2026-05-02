import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createCaptureHandlers } from "../../src/http/handlers.js";
import type { CaptureCoordinator } from "../../src/capture/index.js";
import type { CoordinatorStatusReport } from "../../src/capture/capture-coordinator.js";
import { ok, err } from "../../src/result.js";

interface CoordinatorStub {
  isActive: boolean;
  operationalWorkerCount: number;
  enqueueTask: ReturnType<typeof vi.fn>;
  getStatus: () => CoordinatorStatusReport;
}

const buildStub = (overrides: Partial<CoordinatorStub> = {}): CoordinatorStub => ({
  isActive: true,
  operationalWorkerCount: 1,
  enqueueTask: vi.fn().mockReturnValue(ok()),
  getStatus: (): CoordinatorStatusReport => ({
    taskCounts: { pending: 0, processing: 0, completed: 0 },
    operationalWorkers: 1,
    totalWorkers: 1,
    isRunning: true,
    isDegraded: false,
    workers: [],
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
  captureOptions: { png: true, jpeg: false, html: false },
  dismissBanners: false,
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
        captureOptions: { png: false, jpeg: false, html: false },
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
      }),
    });
    const app = buildApp(stub);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ pending: number; isRunning: boolean }>();
    expect(body.pending).toBe(5);
    expect(body.isRunning).toBe(true);
  });
});
