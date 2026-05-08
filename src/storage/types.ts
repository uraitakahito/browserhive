/**
 * Artifact storage abstraction.
 *
 * Currently has a single production implementation (`S3ArtifactStore`).
 * The interface is preserved as a thin seam so test fixtures
 * (`createTestArtifactStore` in `test/helpers/config.ts`) can substitute
 * an in-memory recorder without spinning up the AWS SDK mock plumbing.
 *
 * Operations:
 *   - `initialize()` runs once at coordinator startup as a fail-fast
 *     health check (e.g. `HeadBucket` against the target bucket).
 *   - `put()` writes one artifact and returns an external location
 *     reference. The capture pipeline embeds that string into
 *     `CaptureResult.{pngLocation,…}` so downstream consumers (logs,
 *     metrics, waggle) can fetch it without re-deriving the path.
 *
 * `put()` MUST set `Content-Type` correctly so direct fetches against
 * `s3://...` URIs (or via signed URL / proxy) serve the right MIME type.
 */
export type ArtifactContentType =
  | "image/png"
  | "image/webp"
  | "text/html"
  | "application/json"
  | "application/pdf"
  | "multipart/related"
  | "application/wacz+zip";

export interface ArtifactStore {
  /**
   * One-shot startup hook. Production impl runs `HeadBucket` against the
   * target bucket to verify existence + credentials. Errors thrown here
   * propagate out of `CaptureCoordinator.initialize` and prevent the
   * server from accepting requests.
   */
  initialize(): Promise<void>;

  /**
   * Persist `body` under the supplied filename and return an external
   * location reference. The S3 impl returns an `s3://<bucket>/<key>` URI.
   */
  put(
    filename: string,
    body: Buffer | string,
    contentType: ArtifactContentType,
  ): Promise<string>;
}
