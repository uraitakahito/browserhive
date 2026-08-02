import { describe, it, expect, vi } from "vitest";
import { ManifestWriter } from "../../src/storage/manifest-writer.js";
import type { ArtifactStore, ArtifactContentType } from "../../src/storage/types.js";
import type { Logger } from "../../src/logger.js";
import type { CaptureResult } from "../../src/capture/types.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

interface Put {
  filename: string;
  body: Buffer | string;
  contentType: ArtifactContentType;
}

const createStore = (
  onPut?: (put: Put) => void,
): ArtifactStore & { puts: Put[] } => {
  const puts: Put[] = [];
  return {
    puts,
    initialize: () => Promise.resolve(),
    put: (filename, body, contentType) => {
      const put = { filename, body, contentType };
      puts.push(put);
      onPut?.(put);
      return Promise.resolve(`s3://bucket/${filename}`);
    },
  };
};

const createLogger = (): Logger & { errors: unknown[][] } => {
  const errors: unknown[][] = [];
  return {
    errors,
    error: (...args: unknown[]) => errors.push(args),
    debug: () => undefined,
  } as unknown as Logger & { errors: unknown[][] };
};

const createResult = (overrides: Partial<CaptureResult> = {}): CaptureResult => ({
  task: {
    taskId: "550e8400-e29b-41d4-a716-446655440000",
    labels: ["nightly"],
    url: "https://example.com/",
    retryCount: 0,
    captureFormats: { png: false, webp: false, html: false, links: false, mhtml: false, wacz: true },
    resetState: DEFAULT_RESET_STATE_OPTIONS,
    correlationId: "abc123de",
    requireSignature: false,
    enqueuedAt: "2024-01-01T00:00:00.000Z",
  },
  status: "success",
  httpStatusCode: 200,
  waczLocation: "s3://browserhive/550e8400-e29b-41d4-a716-446655440000_abc123de_nightly.wacz",
  captureProcessingTimeMs: 18422,
  timestamp: "2024-01-01T00:00:20.000Z",
  workerIndex: 0,
  ...overrides,
});

/** `record` is fire-and-forget; give the pending promise a turn to settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ManifestWriter", () => {
  it("writes the manifest under the same naming rule as the artifacts", async () => {
    const store = createStore();
    new ManifestWriter(store, createLogger()).record(createResult());
    await flush();

    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]!.filename).toBe(
      "550e8400-e29b-41d4-a716-446655440000_abc123de_nightly.result.json",
    );
    expect(store.puts[0]!.contentType).toBe("application/json");
  });

  it("serialises the same report shape the REST endpoint returns", async () => {
    const store = createStore();
    new ManifestWriter(store, createLogger()).record(createResult());
    await flush();

    const manifest = JSON.parse(String(store.puts[0]!.body)) as {
      taskId: string;
      correlationId: string;
      status: string;
      artifacts: { wacz: string };
    };
    expect(manifest.taskId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(manifest.correlationId).toBe("abc123de");
    expect(manifest.status).toBe("success");
    expect(manifest.artifacts.wacz).toBe(
      "s3://browserhive/550e8400-e29b-41d4-a716-446655440000_abc123de_nightly.wacz",
    );
  });

  // Without this, a consumer cannot tell "still running" from "will never
  // produce an artifact" and waits forever.
  it("writes a manifest for failures too, carrying the error detail", async () => {
    const store = createStore();
    new ManifestWriter(store, createLogger()).record(
      createResult({
        status: "timeout",
        waczLocation: undefined,
        errorDetails: { type: "timeout", message: "navigation exceeded 60000ms", timeoutMs: 60_000 },
      }),
    );
    await flush();

    expect(store.puts).toHaveLength(1);
    const manifest = JSON.parse(String(store.puts[0]!.body)) as {
      status: string;
      artifacts: Record<string, string>;
      errorDetails: { type: string };
    };
    expect(manifest.status).toBe("timeout");
    expect(manifest.artifacts).toEqual({});
    expect(manifest.errorDetails.type).toBe("timeout");
  });

  it("omits correlationId from the filename when the task has none", async () => {
    const store = createStore();
    const result = createResult();
    const task = { ...result.task };
    delete task.correlationId;
    new ManifestWriter(store, createLogger()).record({ ...result, task });
    await flush();

    expect(store.puts[0]!.filename).toBe(
      "550e8400-e29b-41d4-a716-446655440000_nightly.result.json",
    );
  });

  // The capture already succeeded and its artifacts are uploaded. A manifest
  // write failure must not propagate into the worker loop.
  it("does not throw when the store rejects, and logs instead", async () => {
    const store: ArtifactStore = {
      initialize: () => Promise.resolve(),
      put: () => Promise.reject(new Error("bucket unreachable")),
    };
    const log = createLogger();

    expect(() => { new ManifestWriter(store, log).record(createResult()); }).not.toThrow();
    await flush();

    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]![1]).toBe("Failed to write result manifest");
  });

  it("does not block the caller on a slow store", () => {
    let resolvePut: (() => void) | undefined;
    const store: ArtifactStore = {
      initialize: () => Promise.resolve(),
      put: () =>
        new Promise<string>((resolve) => {
          resolvePut = () => { resolve("s3://bucket/x"); };
        }),
    };
    const spy = vi.fn();

    new ManifestWriter(store, createLogger()).record(createResult());
    spy(); // reached synchronously despite the put still being in flight

    expect(spy).toHaveBeenCalled();
    expect(resolvePut).toBeDefined();
  });
});
