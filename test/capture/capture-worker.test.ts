import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  ALL_WORKER_HEALTH_VALUES,
  captureWorkerMachine,
  toWorkerHealth,
} from "../../src/capture/capture-worker.js";
import type { CaptureWorkerInput } from "../../src/capture/capture-worker.js";
import type { WorkerRuntime } from "../../src/capture/worker-loop.js";
import type { BrowserClient } from "../../src/capture/browser-client.js";
import { TaskQueue } from "../../src/capture/task-queue.js";

const createMockClient = (): BrowserClient =>
  ({
    index: 0,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connect: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    disconnect: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    process: vi.fn(),
  }) as unknown as BrowserClient;

const createDefaultRuntime = (): WorkerRuntime => ({
  client: createMockClient(),
  taskQueue: new TaskQueue(),
  pollIntervalMs: 50,
});

const createInput = (overrides?: { index?: number; maxRetryCount?: number; runtime?: Partial<WorkerRuntime> }): CaptureWorkerInput => ({
  index: overrides?.index ?? 0,
  maxRetryCount: overrides?.maxRetryCount ?? 2,
  runtime: {
    ...createDefaultRuntime(),
    ...overrides?.runtime,
  },
});

/**
 * Create an actor with the worker status machine.
 * The machine has invoked actors, so we test state transitions
 * by sending events directly.
 */
const createWorkerActor = (overrides?: { index?: number; maxRetryCount?: number; runtime?: Partial<WorkerRuntime> }) => {
  const input = createInput(overrides);
  const actor = createActor(captureWorkerMachine, { input });
  actor.start();
  return { actor, input };
};

describe("capture-worker", () => {
  describe("ALL_WORKER_HEALTH_VALUES", () => {
    it("should contain all flat worker health values", () => {
      expect(ALL_WORKER_HEALTH_VALUES).toContain("ready");
      expect(ALL_WORKER_HEALTH_VALUES).toContain("busy");
      expect(ALL_WORKER_HEALTH_VALUES).toContain("error");
      expect(ALL_WORKER_HEALTH_VALUES).toContain("disconnected");
      expect(ALL_WORKER_HEALTH_VALUES).toHaveLength(4);
    });
  });

  describe("captureWorkerMachine", () => {
    it("should have disconnected as initial state", () => {
      const { actor } = createWorkerActor();
      expect(actor.getSnapshot().value).toBe("disconnected");
    });

    describe("context initialization", () => {
      it("should initialize context from input", () => {
        const { actor } = createWorkerActor({ index: 3 });
        const ctx = actor.getSnapshot().context;
        expect(ctx.index).toBe(3);
        expect(ctx.processedCount).toBe(0);
        expect(ctx.errorCount).toBe(0);
        expect(ctx.errorHistory).toHaveLength(0);
      });
    });

    describe("transitions from disconnected", () => {
      it("should allow CONNECT", () => {
        const snapshot = createWorkerActor().actor.getSnapshot();
        expect(snapshot.can({ type: "CONNECT" })).toBe(true);
      });

      it("should not allow DISCONNECT, TASK_STARTED", () => {
        const snapshot = createWorkerActor().actor.getSnapshot();
        expect(snapshot.can({ type: "DISCONNECT" })).toBe(false);
        expect(snapshot.can({ type: "TASK_STARTED" } as Parameters<typeof snapshot.can>[0])).toBe(false);
      });
    });

    describe("connecting state", () => {
      it("should transition to connecting on CONNECT", () => {
        const { actor } = createWorkerActor();
        actor.send({ type: "CONNECT" });
        expect(actor.getSnapshot().value).toBe("connecting");
      });

      it("should transition to operational on successful connection", async () => {
        const { actor } = createWorkerActor();
        actor.send({ type: "CONNECT" });

        // Wait for fromPromise to resolve
        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        });
      });

      it("should transition to error on connection failure", async () => {
        const client = createMockClient();
        vi.mocked(client.connect).mockResolvedValue({
          ok: false,
          error: { type: "connection", message: "Connection refused" },
        });

        const { actor } = createWorkerActor({ runtime: { client } });
        actor.send({ type: "CONNECT" });

        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("error");
        });

        const ctx = actor.getSnapshot().context;
        expect(ctx.errorCount).toBe(1);
        expect(ctx.errorHistory).toHaveLength(1);
        expect(ctx.errorHistory[0]!.message).toBe("Connection refused");
      });
    });

    describe("operational state", () => {
      const createOperationalActor = async (overrides?: { maxRetryCount?: number; runtime?: Partial<WorkerRuntime> }) => {
        const result = createWorkerActor(overrides);
        result.actor.send({ type: "CONNECT" });
        await vi.waitFor(() => {
          expect(result.actor.getSnapshot().value).toEqual({ operational: "idle" });
        });
        return result;
      };

      it("should have healthy tag", async () => {
        const { actor } = await createOperationalActor();
        expect(actor.getSnapshot().hasTag("healthy")).toBe(true);
      });

      it("idle sub-state should have canProcess tag", async () => {
        const { actor } = await createOperationalActor();
        expect(actor.getSnapshot().hasTag("canProcess")).toBe(true);
      });

      it("should transition idle → processing on TASK_STARTED", async () => {
        const { actor } = await createOperationalActor();
        const task = { taskId: "t1", labels: [], url: "https://example.com", retryCount: 0, captureOptions: { png: true, jpeg: false, html: false } };
        actor.send({ type: "TASK_STARTED", task });
        expect(actor.getSnapshot().value).toEqual({ operational: "processing" });
        expect(actor.getSnapshot().hasTag("healthy")).toBe(true);
        expect(actor.getSnapshot().hasTag("canProcess")).toBe(false);
      });

      it("should transition processing → idle on TASK_DONE and increment processedCount", async () => {
        const { actor } = await createOperationalActor();
        const task = { taskId: "t1", labels: [], url: "https://example.com", retryCount: 0, captureOptions: { png: true, jpeg: false, html: false } };
        const result = { task, status: "success" as const, captureProcessingTimeMs: 100, timestamp: new Date().toISOString(), workerIndex: 0 };

        actor.send({ type: "TASK_STARTED", task });
        actor.send({ type: "TASK_DONE", task, result });

        expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        expect(actor.getSnapshot().context.processedCount).toBe(1);
      });

      it("should requeue task on TASK_FAILED when retries remain (canRetry guard)", async () => {
        const taskQueue = new TaskQueue();
        const { actor } = await createOperationalActor({ runtime: { taskQueue } });
        const task = { taskId: "t1", labels: [], url: "https://example.com", retryCount: 0, captureOptions: { png: true, jpeg: false, html: false } };
        const result = {
          task,
          status: "failed" as const,
          errorDetails: { type: "internal" as const, message: "Page crashed" },
          captureProcessingTimeMs: 50,
          timestamp: new Date().toISOString(),
          workerIndex: 0,
        };

        actor.send({ type: "TASK_STARTED", task });
        actor.send({ type: "TASK_FAILED", task, result });

        expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        const ctx = actor.getSnapshot().context;
        // Retry: no counter increment
        expect(ctx.processedCount).toBe(0);
        expect(ctx.errorCount).toBe(0);
        expect(ctx.errorHistory).toHaveLength(0);
        // Task was requeued
        expect(taskQueue.remaining).toBe(1);
      });

      it("should mark task complete on TASK_FAILED when retries exhausted", async () => {
        const taskQueue = new TaskQueue();
        const { actor } = await createOperationalActor({ runtime: { taskQueue } });
        const task = { taskId: "t1", labels: ["test"], url: "https://example.com", retryCount: 2, captureOptions: { png: true, jpeg: false, html: false } };
        // Simulate dequeue to put task in processing set
        taskQueue.enqueue(task);
        taskQueue.dequeue();
        const result = {
          task,
          status: "failed" as const,
          errorDetails: { type: "internal" as const, message: "Page crashed" },
          captureProcessingTimeMs: 50,
          timestamp: new Date().toISOString(),
          workerIndex: 0,
        };

        actor.send({ type: "TASK_STARTED", task });
        actor.send({ type: "TASK_FAILED", task, result });

        expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        const ctx = actor.getSnapshot().context;
        expect(ctx.processedCount).toBe(1);
        expect(ctx.errorCount).toBe(1);
        expect(ctx.errorHistory).toHaveLength(1);
        expect(ctx.errorHistory[0]!.message).toBe("Page crashed");
        expect(ctx.errorHistory[0]!.task?.taskId).toBe("t1");
        expect(taskQueue.completedCount).toBe(1);
      });

      it("should transition to error on CONNECTION_LOST", async () => {
        const { actor } = await createOperationalActor();
        actor.send({ type: "CONNECTION_LOST", message: "Browser disconnected" });

        expect(actor.getSnapshot().value).toBe("error");
        expect(actor.getSnapshot().context.errorCount).toBe(1);
      });

      it("should transition to disconnecting on DISCONNECT", async () => {
        const { actor } = await createOperationalActor();
        actor.send({ type: "DISCONNECT" });
        expect(actor.getSnapshot().value).toBe("disconnecting");
      });
    });

    describe("error state", () => {
      const createErrorActor = async () => {
        const client = createMockClient();
        vi.mocked(client.connect).mockResolvedValue({
          ok: false,
          error: { type: "connection", message: "fail" },
        });
        const result = createWorkerActor({ runtime: { client } });
        result.actor.send({ type: "CONNECT" });
        await vi.waitFor(() => {
          expect(result.actor.getSnapshot().value).toBe("error");
        });
        return result;
      };

      it("should have no healthy or canProcess tags", async () => {
        const { actor } = await createErrorActor();
        expect(actor.getSnapshot().hasTag("healthy")).toBe(false);
        expect(actor.getSnapshot().hasTag("canProcess")).toBe(false);
      });

      it("should allow DISCONNECT", async () => {
        const { actor } = await createErrorActor();
        expect(actor.getSnapshot().can({ type: "DISCONNECT" })).toBe(true);
      });

      it("should allow CONNECT (for coordinator-driven retry)", async () => {
        const { actor } = await createErrorActor();
        expect(actor.getSnapshot().can({ type: "CONNECT" })).toBe(true);
      });

      it("should transition error → connecting on CONNECT", async () => {
        const { actor } = await createErrorActor();
        actor.send({ type: "CONNECT" });
        expect(actor.getSnapshot().value).toBe("connecting");
      });
    });

    describe("disconnecting state", () => {
      it("should transition to disconnected after disconnect completes", async () => {
        const { actor } = createWorkerActor();
        actor.send({ type: "CONNECT" });
        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        });

        actor.send({ type: "DISCONNECT" });
        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toBe("disconnected");
        });
      });
    });

    describe("error history cap", () => {
      it("should keep at most 10 error records", async () => {
        const { actor } = createWorkerActor();
        actor.send({ type: "CONNECT" });
        await vi.waitFor(() => {
          expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
        });

        // Generate 12 final failures (retryCount >= maxRetryCount to bypass canRetry guard)
        for (let i = 0; i < 12; i++) {
          const task = { taskId: `t${String(i)}`, labels: [], url: "https://example.com", retryCount: 2, captureOptions: { png: true, jpeg: false, html: false } };
          const result = {
            task,
            status: "failed" as const,
            errorDetails: { type: "internal" as const, message: `Error ${String(i)}` },
            captureProcessingTimeMs: 0,
            timestamp: new Date().toISOString(),
            workerIndex: 0,
          };
          actor.send({ type: "TASK_STARTED", task });
          actor.send({ type: "TASK_FAILED", task, result });
        }

        const ctx = actor.getSnapshot().context;
        expect(ctx.errorHistory).toHaveLength(10);
        // Newest first
        expect(ctx.errorHistory[0]!.message).toBe("Error 11");
      });
    });
  });

  describe("toWorkerHealth", () => {
    it("should map disconnected to 'disconnected'", () => {
      const { actor } = createWorkerActor();
      expect(toWorkerHealth(actor.getSnapshot())).toBe("disconnected");
    });

    it("should map operational.idle to 'ready'", async () => {
      const { actor } = createWorkerActor();
      actor.send({ type: "CONNECT" });
      await vi.waitFor(() => {
        expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
      });
      expect(toWorkerHealth(actor.getSnapshot())).toBe("ready");
    });

    it("should map operational.processing to 'busy'", async () => {
      const { actor } = createWorkerActor();
      actor.send({ type: "CONNECT" });
      await vi.waitFor(() => {
        expect(actor.getSnapshot().value).toEqual({ operational: "idle" });
      });
      const task = { taskId: "t1", labels: [], url: "https://example.com", retryCount: 0, captureOptions: { png: true, jpeg: false, html: false } };
      actor.send({ type: "TASK_STARTED", task });
      expect(toWorkerHealth(actor.getSnapshot())).toBe("busy");
    });

    it("should map error to 'error'", async () => {
      const client = createMockClient();
      vi.mocked(client.connect).mockResolvedValue({
        ok: false,
        error: { type: "connection", message: "fail" },
      });
      const { actor } = createWorkerActor({ runtime: { client } });
      actor.send({ type: "CONNECT" });
      await vi.waitFor(() => {
        expect(actor.getSnapshot().value).toBe("error");
      });
      expect(toWorkerHealth(actor.getSnapshot())).toBe("error");
    });

    it("should map connecting to 'error'", () => {
      const client = createMockClient();
      // Make connect hang so we stay in connecting state
      vi.mocked(client.connect).mockReturnValue(new Promise(() => { /* never resolves */ }));
      const { actor } = createWorkerActor({ runtime: { client } });
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().value).toBe("connecting");
      expect(toWorkerHealth(actor.getSnapshot())).toBe("error");
    });
  });
});
