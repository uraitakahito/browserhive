/**
 * S3-compatible artifact store.
 *
 * Targets MinIO and AWS S3 via the same `@aws-sdk/client-s3` SDK. The
 * caller injects the resolved `S3StorageConfig`; this class is unaware
 * of CLI / env handling.
 *
 * `initialize()` runs `HeadBucket` once at startup so misconfigured
 * deployments fail fast — without it, the operator would only learn
 * about a missing bucket / wrong credentials when the first capture
 * task tries to PUT and ends up in `errorHistory`.
 *
 * `put()` issues one `PutObjectCommand` per artifact. The capture
 * pipeline calls this 1–5 times per task (one per enabled format),
 * sequentially — `PageCapturer.capture` does not parallelise the
 * format writes today (see Phase 3 plan: the parallelism trade-off is
 * deferred until measured).
 *
 * Errors are intentionally not caught here: the caller's
 * `errorDetailsFromException` classifies them as `internal`, which the
 * worker's retry budget handles uniformly with other capture failures.
 */
import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3StorageConfig } from "../config/index.js";
import type { ArtifactContentType, ArtifactStore } from "./types.js";

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // MinIO requires path-style addressing because its endpoint
      // hostname does not match the bucket — the SDK's default
      // virtual-hosted-style would route to `bucket.minio:9000` which
      // does not resolve.
      forcePathStyle: config.forcePathStyle ?? true,
    });
    this.bucket = config.bucket;
    this.keyPrefix = config.keyPrefix ?? "";
  }

  /**
   * Verify the configured bucket is reachable and the credentials work.
   * `HeadBucket` is the cheapest call that exercises the full path
   * (DNS / TLS / SigV4 / IAM authorization). Network or auth errors
   * propagate to the caller (`CaptureCoordinator.initialize`), which
   * causes the server to fail to start.
   */
  async initialize(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async put(
    filename: string,
    body: Buffer | string,
    contentType: ArtifactContentType,
  ): Promise<string> {
    const key = this.keyPrefix === ""
      ? filename
      : `${this.keyPrefix}/${filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return `s3://${this.bucket}/${key}`;
  }
}
