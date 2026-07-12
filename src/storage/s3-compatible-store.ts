/**
 * S3-compatible artifact store.
 *
 * Targets self-hosted SeaweedFS (the bundled default) and any other
 * S3-compatible store (AWS S3, Cloudflare R2, MinIO-compatible managed
 * services) via the same `@aws-sdk/client-s3` SDK. The caller injects
 * the resolved `StorageConfig`; this class is unaware of CLI / env
 * handling.
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

/**
 * Maximum number of HeadBucket attempts during initialize().
 * Five 1-second-spaced attempts cover the bucket-bootstrap race on the
 * bundled SeaweedFS (the master gRPC plane creates the bucket via
 * `etc/seaweedfs/init-bucket.sh` but the S3 listener takes a moment to
 * refresh from filer). A genuine configuration error — wrong bucket
 * name, bad credentials, unreachable endpoint past the SDK's own retry
 * — still fails the full budget within ~5s, so fail-fast is preserved.
 */
const HEAD_BUCKET_MAX_ATTEMPTS = 5;
const HEAD_BUCKET_RETRY_DELAY_MS = 1000;

/**
 * Whether the S3 SDK error carries HTTP 404. Only 404 is retried — any
 * other status indicates a real misconfiguration (403 / 401 / 5xx) that
 * retrying will not fix. Network-level errors (ECONNREFUSED, EAI_AGAIN)
 * are already retried by the AWS SDK's default retry strategy, so they
 * do not need a second layer here and arrive as plain `Error`s without
 * `$metadata` once that budget is exhausted.
 */
const isBucketMissing = (err: unknown): boolean => {
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
   *
   * 404-only short retry:
   *
   * Self-hosted S3 implementations (notably the SeaweedFS bundled by
   * `bin/up.sh` and the downstream waggle stack) finalise
   * bucket creation through their master / filer plane and *then*
   * propagate the existence to the S3 listener. That propagation is
   * normally instantaneous but can lag by hundreds of ms — long enough
   * for browserhive's startup HeadBucket to land during the window and
   * get a 404 even though the bucket is, in fact, being created right
   * then by `etc/seaweedfs/init-bucket.sh`.
   *
   * Without retry, browserhive crashes (exit 1), the orchestrator
   * (compose `--abort-on-container-exit` semantics, k8s liveness
   * restart) tears it down and brings it back up. In waggle's
   * `--profile run --exit-code-from waggle` flow, the restart loop
   * trips `--abort-on-container-exit` before the waggle service can
   * actually run, tearing down the whole stack.
   *
   * Retry policy: 5 attempts, 1 second apart, 404 only. Genuine config
   * errors (403 / 401, network unreachable past the SDK's own retry)
   * still fail-fast within that 5-second budget.
   */
  async initialize(): Promise<void> {
    for (let attempt = 1; attempt <= HEAD_BUCKET_MAX_ATTEMPTS; attempt++) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return;
      } catch (err) {
        if (attempt === HEAD_BUCKET_MAX_ATTEMPTS || !isBucketMissing(err)) {
          throw err;
        }
        // 404: bucket bootstrap race. Wait briefly and retry.
        await sleep(HEAD_BUCKET_RETRY_DELAY_MS);
      }
    }
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
