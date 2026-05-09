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

describe("S3CompatibleArtifactStore.initialize", () => {
  it("issues HeadBucket against the configured bucket", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});

    const store = new S3CompatibleArtifactStore(baseConfig());
    await store.initialize();

    const calls = s3Mock.commandCalls(HeadBucketCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({ Bucket: "browserhive-test" });
  });

  it("propagates HeadBucket errors so the server fails to start", async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error("NoSuchBucket"));

    const store = new S3CompatibleArtifactStore(baseConfig());

    await expect(store.initialize()).rejects.toThrow("NoSuchBucket");
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
