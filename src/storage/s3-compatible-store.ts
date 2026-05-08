/**
 * S3-compatible artifact store.
 *
 * Targets self-hosted SeaweedFS (the bundled default) and any other
 * S3-compatible store (AWS S3, Cloudflare R2, MinIO-compatible managed
 * services) via the same `@aws-sdk/client-s3` SDK. The caller injects
 * the resolved `StorageConfig`; this class is unaware of CLI / env
 * handling.
 *
 * Naming: the `S3Compatible` prefix is intentional. `@aws-sdk/client-s3`
 * speaks the S3 wire protocol, but the protocol is implemented by many
 * vendors beyond AWS itself — naming the class `S3CompatibleArtifactStore`
 * keeps that fact load-bearing in the type so a future reader doesn't
 * mistake it for AWS-only. If a non-S3-API backend is ever added (GCS,
 * Azure Blob, …), it would land as a sibling implementation
 * (`ObjectStorageArtifactStore` etc.) rather than getting folded in here.
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
import type { StorageConfig } from "../config/index.js";
import type { ArtifactContentType, ArtifactStore } from "./types.js";

export class S3CompatibleArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Defaults to virtual-hosted-style addressing (the AWS S3 form).
      // SeaweedFS / MinIO / Ceph and most other self-hosted S3
      // implementations require path-style because the endpoint hostname
      // does not match the bucket — the SDK's virtual-hosted form would
      // route to `bucket.seaweedfs:8333`, which does not resolve. Opt
      // back into path-style via `--s3-force-path-style` (or
      // `BROWSERHIVE_S3_FORCE_PATH_STYLE=true`) for those deployments.
      forcePathStyle: config.forcePathStyle ?? false,
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
