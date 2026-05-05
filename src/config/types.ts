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
  /** Image quality (1-100, only for jpeg) */
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
   * path-style addressing (`endpoint/bucket/key`) because the endpoint
   * hostname does not match the bucket. AWS S3 supports
   * virtual-hosted-style by default. Defaults to `true` so the bundled
   * SeaweedFS works out of the box.
   */
  forcePathStyle?: boolean;
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

/** Client TLS configuration */
export interface ClientTlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** CA certificate file path (for server verification) */
  caCertPath: string;
}

/** BrowserHive configuration */
export interface BrowserHiveConfig {
  /** HTTP server port */
  port: number;
  /** TLS configuration (insecure if undefined) */
  tls?: TlsConfig;
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
