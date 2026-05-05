/**
 * Artifact storage abstraction.
 *
 * Decouples `PageCapturer` from the concrete sink (local FS / S3-compatible
 * object store). The concrete implementations live alongside this file
 * under `src/storage/`.
 *
 * Operations:
 *   - `initialize()` runs once at coordinator startup as a fail-fast
 *     health check (e.g. `mkdir -p` for local, `HeadBucket` for S3).
 *   - `put()` writes one artifact and returns an external location
 *     reference. The capture pipeline embeds that string into
 *     `CaptureResult.{pngLocation,…}` so downstream consumers (logs,
 *     metrics, waggle) can fetch it without re-deriving the path.
 *
 * `put()` MUST set `Content-Type` correctly on object stores even though
 * the local store ignores it — direct browser fetches via
 * `s3://...` proxies depend on it.
 */
export type ArtifactContentType =
  | "image/png"
  | "image/jpeg"
  | "text/html"
  | "application/json"
  | "application/pdf";

export interface ArtifactStore {
  /**
   * One-shot startup hook. Local: `mkdir -p outputDir`. S3: `HeadBucket`
   * to verify bucket existence + credentials. Errors thrown here propagate
   * out of `CaptureCoordinator.initialize` and prevent the server from
   * accepting requests.
   */
  initialize(): Promise<void>;

  /**
   * Persist `body` under the supplied filename and return an external
   * location reference.
   *
   * Local: returns the absolute file path (`/app/output/<filename>`).
   * S3:    returns an `s3://<bucket>/<key>` URI.
   */
  put(
    filename: string,
    body: Buffer | string,
    contentType: ArtifactContentType,
  ): Promise<string>;
}
