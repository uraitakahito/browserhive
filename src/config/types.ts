/**
 * Configuration Types
 *
 * Hierarchical configuration structure for the application.
 * BrowserHiveConfig > CoordinatorConfig > CaptureConfig
 */

import type { BehaviorConfig } from "../behaviors/types.js";

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
   * bundled SeaweedFS defined in `docker-compose.yml` opts in via
   * `BROWSERHIVE_S3_FORCE_PATH_STYLE=true`.
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
   * `/sign` endpoint of the wacz-auth signing service.
   *
   * Undefined means no service is configured. A capture that asked to be
   * signed still produces a WACZ, reported as `signature.signed: false` — a
   * signature is not what makes an archive worth keeping.
   */
  signingUrl?: string;
  /** Bearer token for the signing service, when it requires one. */
  signingToken?: string;
  /**
   * How long to wait for a signature before giving up and going out unsigned.
   *
   * A signature is optional, so there is no version of this where holding the
   * capture open is the right trade.
   */
  signingTimeoutMs: number;
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

/**
 * How many passes a capture makes over the page.
 *
 * - `single-pass` — the default: load the page once, at the configured device
 *   pixel ratio, with the browser cache in play.
 * - `multipass` — load the same page once per device pixel ratio (currently 1
 *   and 2) into a single WACZ, so replay is correct on both normal and Retina
 *   displays. Each pass is fetched with the **browser cache disabled**: a second
 *   pass served from cache would defeat the point of multiple passes, and a
 *   revalidated (`304`) response carries no body, which would leave holes in the
 *   archive. Costs roughly twice the time and bytes.
 */
export type ArchiveMode = "single-pass" | "multipass";

/**
 * How a capture treats the browser's HTTP cache.
 *
 *   default — use it. A URL captured before can come back `304 Not Modified`,
 *             which carries no body, so there is nothing to archive and the
 *             capture fails.
 *   bypass  — do not read the cache for this capture. Entries left by earlier
 *             captures stay where they are.
 *   clear   — empty the whole cache first, then capture without reading it.
 *             Nothing an earlier capture stored can influence this one.
 *
 * Neither of the last two stops the capture from FILLING the cache. Chromium
 * keeps storing responses while cache reads are disabled — measured, and the
 * opposite of what "cache disabled" suggests. So a `default` capture of the
 * same URL afterwards still sees a 304 either way, which is why the shipped
 * default clears on every capture rather than expecting one reset to hold.
 */
export type CacheMode = "default" | "bypass" | "clear";

export interface CaptureConfig {
  /**
   * Server-wide default delay (ms) inserted before each browser operation, for
   * watching a headless capture render over the DevTools screencast. A
   * request's `operationDelayMs` overrides it; `0` disables it.
   *
   * Named for what it does rather than after puppeteer's `slowMo`: this is our
   * own adapter (see `capture/capture-page.ts`), it paces only the operations
   * we issue, and it applies per capture. The connect-time `slowMo` was removed
   * so exactly one knob controls this.
   */
  operationDelayMs: number;
  /**
   * Server-wide default for the observability trace written to the *captured
   * page's* console, for reading over `chrome://inspect` alongside the live
   * screencast. A request's `trace` overrides it.
   *
   * Deliberately limited to what DevTools cannot show by itself: what
   * BrowserHive did to the page, what its behaviors decided, and which
   * responses did not make it into the archive. Timings are not traced —
   * the Network and Performance panels already show them better.
   */
  trace: boolean;
  /** Server-wide default archive mode. Overridable per request. */
  archiveMode: ArchiveMode;
  /**
   * Server-wide default for the HTTP cache, overridable per request.
   *
   * Ships as `clear`, because this is an archiver: an archive assembled from
   * cache hits is not an archive. A `304` carries no body, so the bytes that
   * were supposed to be recorded never crossed the wire.
   *
   * The cost is one CDP round trip per capture, which in steady state clears
   * an already-empty cache — `clear` also captures with the cache disabled, so
   * nothing is stored to clear next time. What it buys is that a single
   * `cache: "default"` request cannot leave residue behind that affects
   * everything after it. Deployments where the re-fetching matters can set
   * `BROWSERHIVE_CACHE=default`.
   */
  cache: CacheMode;
  timeouts: {
    /** Page load timeout. */
    pageLoadMs: number;
    /** Capture operation timeout. */
    captureMs: number;
    /**
     * Layer B safety net — upper bound for the entire `PageCapturer.capture`
     * invocation, applied in `BrowserClient.process`. Must be wider than the
     * sum of the inner Layer A timeouts (newPage + pageLoad + dynamic-content
     * wait + addStyleTag + dismissBanners + behaviors + N × capture). Catches
     * any hang that escapes the per-call wraps inside `PageCapturer.capture`.
     */
    taskTotalMs: number;
  };
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
    /**
     * Device pixel ratio (`window.devicePixelRatio`) the capture browser
     * renders at. `1` is a normal display; `2` is Retina, which makes the page
     * request the `2x` srcset / responsive-image candidates — the fix for
     * JS carousels (e.g. apple.com TV+) whose slides have no srcset and compute
     * their image URL from the DPR, so the `2x` variant is unreachable at DPR 1.
     * Also scales PNG / WebP screenshots by the same factor.
     */
    deviceScaleFactor: number;
  };
  /**
   * Behavior configuration. The behavior runtime (src/behaviors/runtime/) is
   * injected into each page and runs the enabled built-ins — `autoscroll`
   * (scrolls the full height so lazy loaders fire) and `autofetch` (pulls all
   * srcset/data-* candidates so replay is DPR/viewport-complete) — plus any
   * client-supplied custom behaviors. Replaces the former native `autoScroll`.
   */
  behaviors: BehaviorConfig;
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
  /**
   * How many finished `CaptureResult`s to keep in memory for
   * `GET /v1/captures/{taskId}`. Oldest are evicted first. `0` disables the
   * cache entirely — the endpoint then only ever answers 202 or 404, and the
   * `.result.json` manifest in the artifact store is the sole record.
   */
  resultCacheSize: number;
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

export interface ClientTlsConfig {
  /** Whether to enable TLS */
  enabled: boolean;
  /** CA certificate file path (for server verification) */
  caCertPath: string;
}

/** Worker-membership discovery configuration (DnsRegistry). */
export interface DiscoveryConfig {
  /** How often (ms) DnsRegistry re-resolves worker membership from DNS. */
  refreshMs: number;
  /**
   * Boot-time only: how many times `CaptureCoordinator.initialize` re-resolves
   * worker membership before giving up. A cold stack can start browserhive
   * before the chromium workers' DNS names are registered — all NXDOMAIN would
   * otherwise be fatal — so the initial resolve is retried with backoff to
   * absorb that registration race. Must be >= 1 (1 = no retry). The runtime
   * refresh already tolerates zero workers, so this affects startup only.
   */
  initRetryAttempts: number;
  /** Base delay (ms) for the exponential init-retry backoff (capped internally). */
  initRetryDelayMs: number;
}

export interface BrowserHiveConfig {
  http: HttpServerConfig;
  coordinator: CoordinatorConfig;
  discovery: DiscoveryConfig;
}

/** Browser connection options for connecting to a remote Chromium instance */
export interface BrowserConnectOptions {
  /** Remote browser URL, parsed & validated to http(s) at the CLI boundary. */
  browserURL: URL;
}

/** Browser profile configuration (connection settings + capture settings) */
export interface BrowserProfile extends BrowserConnectOptions {
  /** Capture configuration for this browser */
  capture: CaptureConfig;
}
