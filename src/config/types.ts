/**
 * Configuration Types
 *
 * Hierarchical configuration structure for the application.
 * BrowserHiveConfig > CoordinatorConfig > CaptureConfig
 */

/** Screenshot configuration compatible with Puppeteer ScreenshotOptions */
export interface ScreenshotConfig {
  /** Capture full page screenshot */
  fullPage: boolean;
  /** Image quality (1-100, only for webp) */
  quality?: number;
}

/**
 * S3-compatible artifact storage configuration. The server writes every
 * captured artifact to a single bucket via `@aws-sdk/client-s3`, which
 * works against the bundled SeaweedFS and any other S3-compatible
 * store — AWS S3, Cloudflare R2, MinIO-compatible managed services.
 */
export interface StorageConfig {
  /** Endpoint URL (e.g. `http://seaweedfs:8333` for the bundled SeaweedFS, `https://s3.amazonaws.com` for AWS). */
  endpoint: string;
  /** Region label sent on every request. SeaweedFS ignores it; AWS does not. */
  region: string;
  /** Target bucket. Must exist before the server starts. */
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional prefix prepended to every object key (no trailing slash needed). */
  keyPrefix?: string;
  /**
   * SeaweedFS (and most S3-compatible self-hosted stores) require
   * path-style addressing because the endpoint hostname does not match
   * the bucket. The two URL shapes, for `bucket=browserhive`,
   * `key=foo.png`:
   *
   *   - Virtual-hosted-style (`forcePathStyle: false`):
   *       `https://browserhive.s3.amazonaws.com/foo.png`
   *     Bucket as a subdomain. Works on AWS via the
   *     `*.s3.amazonaws.com` wildcard DNS; fails on self-hosted
   *     because e.g. `browserhive.seaweedfs:8333` does not resolve.
   *   - Path-style (`forcePathStyle: true`):
   *       `http://seaweedfs:8333/browserhive/foo.png`
   *     Bucket in the path, host stays as the configured endpoint.
   *     Single-hostname services (SeaweedFS / MinIO / Ceph / …)
   *     resolve correctly.
   *
   * Defaults to `false` (virtual-hosted-style — the AWS S3 form). The
   * bundled SeaweedFS in compose.dev.yaml / compose.prod.yaml opts in
   * via `BROWSERHIVE_S3_FORCE_PATH_STYLE=true`.
   */
  forcePathStyle?: boolean;
}

/**
 * Server-wide default for the inter-task wipe performed by
 * `page-capturer.ts:resetPageState`. The HTTP layer's `resetState` field
 * is resolved against this at the request-mapper boundary, so the capture
 * layer only ever sees a fully-merged value via `CaptureTask.resetState`.
 *
 * `cookies` controls CDP `Network.clearBrowserCookies`. `pageContext`
 * controls the `page.goto("about:blank")` step (which also tears down
 * origin-scoped storage as a side-effect — see `reset-state.ts` for the
 * "two axes, not three" rationale).
 */
export interface ResetPageStateConfig {
  cookies: boolean;
  pageContext: boolean;
}

/**
 * Filter / limit policy for the WACZ capture format. Each field is also
 * exposed as a CLI flag in `src/cli/server-cli.ts` (Phase 5); this struct
 * is the resolved-once-at-startup form the capture pipeline reads.
 */
export interface WaczConfig {
  /** Glob patterns matched against full URL — matched URLs are dropped before recording. */
  blockUrlPatterns: string[];
  /** MIME prefixes (`video/`, `audio/`, …) — body omitted, request/response meta still recorded. */
  skipContentTypes: string[];
  /** Per-response body cap. Larger bodies become `metadata { truncated: too-large }`. */
  maxResponseBytes: number;
  /** Cumulative body cap per task. Once cleared, subsequent bodies become `metadata { truncated: task-cap }`. */
  maxTaskBytes: number;
  /** Cap on the in-flight pending-request map (FIFO eviction when exceeded). */
  maxPendingRequests: number;
  /** Software identifier embedded in WARC `warcinfo` + WACZ `datapackage.json`. */
  software: string;
  /**
   * Query parameter names treated as cache-busters for fuzzy matching at
   * replay time. The packager emits a `fuzzy.json` file in the WACZ
   * containing strip rules for these names so replay tooling that honours
   * the file (or that BrowserHive's own viewer checks) can match a recorded
   * response even when the live JS regenerates a new value (e.g.
   * `?_=${Date.now()}`). Replay engines that don't read `fuzzy.json` (most
   * of them today) fall back to their own built-in cache-buster heuristics
   * — the file is a forward-looking artifact.
   */
  fuzzyParams: string[];
}

/** Capture configuration */
export interface CaptureConfig {
  /** Timeout settings */
  timeouts: {
    /** Page load timeout in milliseconds */
    pageLoad: number;
    /** Capture operation timeout in milliseconds */
    capture: number;
    /**
     * Layer B safety net — upper bound for the entire `PageCapturer.capture`
     * invocation, applied in `BrowserClient.process`. Must be wider than the
     * sum of the inner Layer A timeouts (newPage + pageLoad + dynamic-content
     * wait + addStyleTag + dismissBanners + N × capture). Catches any
     * hang that escapes the per-call wraps inside `PageCapturer.capture`.
     */
    taskTotal: number;
  };
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Screenshot options */
  screenshot: ScreenshotConfig;
  /** Custom User-Agent string (uses browser default if undefined) */
  userAgent?: string;
  /** Server-wide default for inter-task wipe. Both axes default to true. */
  resetPageState: ResetPageStateConfig;
  /**
   * WACZ recorder policy. Optional — when undefined, requests with
   * `captureFormats.wacz: true` fail with an `internal` error. Populated by
   * `server-cli.ts:buildServerConfig` from CLI flags + env vars.
   */
  wacz?: WaczConfig;
}

/** Coordinator configuration */
export interface CoordinatorConfig {
  /** List of browser profile configurations */
  browserProfiles: BrowserProfile[];
  /** Where captured artifacts are written. Server-wide, not per-profile. */
  storage: StorageConfig;
  /** Maximum retry count for failed capture tasks */
  maxRetryCount: number;
  /** Queue poll interval in milliseconds when queue is empty */
  queuePollIntervalMs: number;
  /** Reject capture requests for URLs already in the queue */
  rejectDuplicateUrls: boolean;
}

/** Server TLS configuration */
export interface TlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** Server certificate file path */
  certPath: string;
  /** Private key file path */
  keyPath: string;
}

/** HTTP server configuration consumed by `HttpServer`. */
export interface HttpServerConfig {
  port: number;
  tls?: TlsConfig;
}

/** Client TLS configuration */
export interface ClientTlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** CA certificate file path (for server verification) */
  caCertPath: string;
}

/** BrowserHive configuration */
export interface BrowserHiveConfig {
  http: HttpServerConfig;
  coordinator: CoordinatorConfig;
}

/** Browser connection options for connecting to a remote Chromium instance */
export interface BrowserConnectOptions {
  /** Remote browser URL (e.g., http://puppeteer:9222) */
  browserURL: string;
  /** Slow down Puppeteer operations by the specified milliseconds */
  slowMo?: number;
}

/** Browser profile configuration (connection settings + capture settings) */
export interface BrowserProfile extends BrowserConnectOptions {
  /** Capture configuration for this browser */
  capture: CaptureConfig;
}
