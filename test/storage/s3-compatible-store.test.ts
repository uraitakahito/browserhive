/**
 * S3CompatibleArtifactStore unit tests.
 *
 * Uses `aws-sdk-client-mock` to capture commands sent to the S3 client
 * without touching the network. Covers: bucket-existence preflight,
 * key construction (with and without prefix), location URI shape,
 * Content-Type propagation, and error propagation on PUT.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient, type AwsClientStub } from "aws-sdk-client-mock";
import { S3CompatibleArtifactStore } from "../../src/storage/s3-compatible-store.js";
import type { StorageConfig } from "../../src/config/index.js";

const baseConfig = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: "http://seaweedfs:8333",
  region: "us-east-1",
  bucket: "browserhive-test",
  accessKeyId: "AKIATESTACCESSKEYID",
  secretAccessKey: "test-secret",
  forcePathStyle: true,
  ...overrides,
});

let s3Mock: AwsClientStub<S3Client>;

beforeEach(() => {
  s3Mock = mockClient(S3Client);
});

/**
 * Build a fake S3-SDK error that carries the given HTTP status code in
 * `$metadata.httpStatusCode`, so the production code's `isBucketMissing`
 * predicate can read it just like a real `@aws-sdk/client-s3` error.
 */
const makeS3Error = (status: number, name: string): Error => {
  const err = new Error(name) as Error & {
    $metadata?: { httpStatusCode: number };
  };
  err.name = name;
  err.$metadata = { httpStatusCode: status };
  return err;
};

describe("S3CompatibleArtifactStore.initialize", () => {
  it("issues HeadBucket against the configured bucket on success", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});

    const store = new S3CompatibleArtifactStore(baseConfig());
    await store.initialize();

    const calls = s3Mock.commandCalls(HeadBucketCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({ Bucket: "browserhive-test" });
  });

  it("retries on 404 and succeeds when the bucket becomes visible", async () => {
    s3Mock
      .on(HeadBucketCommand)
      .rejectsOnce(makeS3Error(404, "NotFound"))
      .rejectsOnce(makeS3Error(404, "NotFound"))
      .resolves({});

    const store = new S3CompatibleArtifactStore(baseConfig());
    const start = Date.now();
    await store.initialize();
    const elapsed = Date.now() - start;

    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(3);
    // Two 1-second sleeps between three attempts.
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(4000);
  });

  it("gives up after the max retry budget on persistent 404", async () => {
    s3Mock.on(HeadBucketCommand).rejects(makeS3Error(404, "NotFound"));

    const store = new S3CompatibleArtifactStore(baseConfig());

    await expect(store.initialize()).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(5);
  });

  it("does NOT retry on 403 — credentials are not a transient issue", async () => {
    s3Mock.on(HeadBucketCommand).rejects(makeS3Error(403, "Forbidden"));

    const store = new S3CompatibleArtifactStore(baseConfig());

    await expect(store.initialize()).rejects.toMatchObject({
      $metadata: { httpStatusCode: 403 },
    });
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(1);
  });

  it("does NOT retry on network errors (no $metadata) — SDK's own retry already covers these", async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error("ECONNREFUSED"));

    const store = new S3CompatibleArtifactStore(baseConfig());

    await expect(store.initialize()).rejects.toThrow("ECONNREFUSED");
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(1);
  });
});

describe("S3CompatibleArtifactStore.put", () => {
  it("uploads with the supplied filename as the key (no prefix)", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3CompatibleArtifactStore(baseConfig());
    const location = await store.put(
      "task-id_label.png",
      Buffer.from("fake-png"),
      "image/png",
    );

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.Bucket).toBe("browserhive-test");
    expect(input.Key).toBe("task-id_label.png");
    expect(input.ContentType).toBe("image/png");
    expect(input.Body).toBeInstanceOf(Buffer);
    expect((input.Body as Buffer).toString()).toBe("fake-png");
    expect(location).toBe("s3://browserhive-test/task-id_label.png");
  });

  it("prepends keyPrefix with a single `/` separator", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3CompatibleArtifactStore(
      baseConfig({ keyPrefix: "captures/2026-05-05" }),
    );
    const location = await store.put(
      "task-id.html",
      "<html></html>",
      "text/html",
    );

    const input = s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(input.Key).toBe("captures/2026-05-05/task-id.html");
    expect(location).toBe(
      "s3://browserhive-test/captures/2026-05-05/task-id.html",
    );
  });

  it("forwards Content-Type for each known artifact type", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3CompatibleArtifactStore(baseConfig());
    await store.put("a.png", Buffer.from(""), "image/png");
    await store.put("a.webp", Buffer.from(""), "image/webp");
    await store.put("a.html", "", "text/html");
    await store.put("a.links.json", "{}", "application/json");

    const types = s3Mock
      .commandCalls(PutObjectCommand)
      .map((c) => c.args[0].input.ContentType);
    expect(types).toEqual([
      "image/png",
      "image/webp",
      "text/html",
      "application/json",
    ]);
  });

  it("propagates PutObject errors so the capture pipeline can classify them", async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error("AccessDenied"));

    const store = new S3CompatibleArtifactStore(baseConfig());

    await expect(
      store.put("a.png", Buffer.from(""), "image/png"),
    ).rejects.toThrow("AccessDenied");
  });
});
