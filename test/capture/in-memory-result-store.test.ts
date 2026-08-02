import { describe, it, expect } from "vitest";
import { InMemoryResultStore } from "../../src/capture/in-memory-result-store.js";
import type { CaptureResult } from "../../src/capture/types.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

const createResult = (taskId: string, overrides: Partial<CaptureResult> = {}): CaptureResult => ({
  task: {
    taskId,
    labels: [],
    url: `https://example.com/${taskId}`,
    retryCount: 0,
    captureFormats: { png: false, webp: false, html: false, links: false, mhtml: false, wacz: true },
    resetState: DEFAULT_RESET_STATE_OPTIONS,
    requireSignature: false,
    enqueuedAt: "2024-01-01T00:00:00.000Z",
  },
  status: "success",
  captureProcessingTimeMs: 100,
  timestamp: "2024-01-01T00:00:01.000Z",
  workerIndex: 0,
  ...overrides,
});

describe("InMemoryResultStore", () => {
  it("returns a recorded result by taskId", () => {
    const store = new InMemoryResultStore(10);
    store.record(createResult("t1"));

    expect(store.get("t1")?.task.taskId).toBe("t1");
  });

  it("returns undefined for a taskId it never saw", () => {
    const store = new InMemoryResultStore(10);
    expect(store.get("never-recorded")).toBeUndefined();
  });

  it("evicts the oldest entry once capacity is exceeded", () => {
    const store = new InMemoryResultStore(3);
    store.record(createResult("t1"));
    store.record(createResult("t2"));
    store.record(createResult("t3"));
    expect(store.size).toBe(3);

    store.record(createResult("t4"));

    expect(store.size).toBe(3);
    expect(store.get("t1")).toBeUndefined(); // evicted
    expect(store.get("t2")?.task.taskId).toBe("t2");
    expect(store.get("t4")?.task.taskId).toBe("t4");
  });

  it("overwrites rather than grows when the same taskId is recorded twice", () => {
    const store = new InMemoryResultStore(3);
    store.record(createResult("t1", { status: "success" }));
    store.record(createResult("t1", { status: "failed" }));

    expect(store.size).toBe(1);
    expect(store.get("t1")?.status).toBe("failed");
  });

  // A capacity of 0 is how an operator turns the REST lookup off entirely and
  // relies solely on the durable `.result.json` manifest.
  it("keeps nothing when capacity is 0", () => {
    const store = new InMemoryResultStore(0);
    store.record(createResult("t1"));

    expect(store.size).toBe(0);
    expect(store.get("t1")).toBeUndefined();
  });

  it("keeps only the newest entry at capacity 1", () => {
    const store = new InMemoryResultStore(1);
    store.record(createResult("t1"));
    store.record(createResult("t2"));

    expect(store.size).toBe(1);
    expect(store.get("t1")).toBeUndefined();
    expect(store.get("t2")?.task.taskId).toBe("t2");
  });

  it("records failures too, so a client can tell 'failed' from 'never ran'", () => {
    const store = new InMemoryResultStore(10);
    store.record(
      createResult("t1", {
        status: "timeout",
        errorDetails: { type: "timeout", message: "navigation exceeded", timeoutMs: 60_000 },
      }),
    );

    expect(store.get("t1")?.status).toBe("timeout");
    expect(store.get("t1")?.errorDetails?.timeoutMs).toBe(60_000);
  });
});
