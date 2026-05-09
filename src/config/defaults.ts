import type {
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
  WaczConfig,
} from "./types.js";

/**
 * Default slowMo value for browser connections.
 *
 * Slows down Puppeteer operations by the specified amount of milliseconds to aid debugging.
 *
 * @see https://pptr.dev/api/puppeteer.connectoptions
 */
export const DEFAULT_BROWSER_SLOW_MO_MS = 0;

/**
 * Default wait time for dynamic content to load (ms).
 *
 * Used with page.evaluate() to wait for dynamic content after page load.
 * The function passed to page.evaluate returns a Promise, which Puppeteer awaits automatically.
 *
 * @see https://pptr.dev/api/puppeteer.page.evaluate
 */
export const DEFAULT_DYNAMIC_CONTENT_WAIT_MS = 3000;

/**
 * Default block-list for the WACZ recorder. Targets common
 * analytics / advertising / behavioural-tracking origins so the WARC stays
 * focused on the captured page's actual content. Phase 5 exposes
 * `--wacz-block-pattern` to override; deployments can extend the list
 * without code changes.
 */
export const DEFAULT_WACZ_BLOCK_PATTERNS: readonly string[] = [
  "*://*.google-analytics.com/*",
  "*://*.googletagmanager.com/*",
  "*://*.doubleclick.net/*",
  "*://*.facebook.com/tr*",
  "*://*.scorecardresearch.com/*",
  "*://*.hotjar.com/*",
  "*://*.segment.io/*",
  "*://*.amplitude.com/*",
  "*://*.mixpanel.com/*",
  "*://*.adsystem.com/*",
];

/**
 * Default fuzzy-match query parameter names. Common cache-buster idioms
 * across jQuery / Axios / hand-rolled fetch wrappers — stripped at replay
 * time so a request like `/api/data?_=1700000000000` matches the recorded
 * one regardless of the live `Date.now()` value.
 */
export const DEFAULT_WACZ_FUZZY_PARAMS: readonly string[] = [
  "_",
  "cb",
  "nocache",
  "t",
  "nonce",
  "timestamp",
  "_t",
  "_v",
  "ts",
];

/** Default WACZ recording limits. Phase 5 exposes each via CLI / env. */
export const DEFAULT_WACZ_CONFIG: WaczConfig = {
  blockUrlPatterns: [...DEFAULT_WACZ_BLOCK_PATTERNS],
  skipContentTypes: [],
  maxResponseBytes: 20 * 1024 * 1024,
  maxTaskBytes: 200 * 1024 * 1024,
  maxPendingRequests: 5000,
  // Replaced at startup by `server-cli.ts:buildServerConfig` with the value
  // from `package.json` so the WARC `warcinfo` record carries the real
  // package version. Falls back to the literal here for tests / fixtures
  // that build a CaptureConfig without going through the CLI builder.
  software: "browserhive/0.0.0",
  fuzzyParams: [...DEFAULT_WACZ_FUZZY_PARAMS],
};

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  timeouts: {
    pageLoad: 30000,
    capture: 10000,
    // Layer B outer task budget. Sized to be larger than the worst-case
    // sum of inner Layer A bounds in PageCapturer.capture:
    //   pageLoad(30s) + dynamic-wait(5s) + addStyleTag(5s) + dismissBanners(5s)
    //   + 3 × capture(10s) = 75s. (newPage / page.close are no longer in the
    //   sum: BrowserClient holds a single Chromium tab for the worker's whole
    //   lifetime and capture only navigates it. The 3 × capture term covers
    //   PNG + WebP + HTML in the all-formats-on case; link extraction
    //   shares the same per-call budget but is rarely combined with all three.)
    // 100s leaves a 25s buffer for un-wrapped CDP single calls (setViewport /
    // setUserAgent / setExtraHTTPHeaders) and for the redirect-aware retry in
    // runOnStableContext (see page-capturer.ts: a single helper call can burn
    // up to ~39s on screenshot/content if every attempt hits destroyed-context).
    // Layer B must always exceed the Layer A sum so that a hang in the
    // un-wrapped gap is the only thing this safety net catches — never a
    // steady-state success. Tune via --task-timeout / BROWSERHIVE_TASK_TIMEOUT_MS.
    taskTotal: 100000,
  },
  viewport: {
    width: 1280,
    height: 800,
  },
  screenshot: {
    fullPage: false,
  },
  resetPageState: {
    cookies: true,
    pageContext: true,
  },
};

/**
 * Defaults that apply regardless of the deploy target. `storage` and
 * `browserProfiles` have no meaningful default — they are always supplied by
 * `buildServerConfig` in `server-cli.ts` from CLI / env input — so they are
 * absent from this object. Test fixtures fill them in via
 * `createTestCoordinatorConfig`.
 */
export const DEFAULT_COORDINATOR_CONFIG = {
  browserProfiles: [],
  // Doubles as an implicit safety net for short transient external-dependency
  // hiccups — most notably brief S3 put outages during artifact upload. Each
  // retry is another full capture attempt, so a value of 2 lets a
  // ~tens-of-seconds storage outage silently recover before exhausting the
  // budget. The artifact store therefore intentionally has ONLY a startup
  // HeadBucket fail-fast check (no runtime probe / circuit breaker); runtime
  // put failures fall back on this implicit retry budget. Lowering this below
  // 2 weakens that safety net.
  maxRetryCount: 2,
  queuePollIntervalMs: 50,
  rejectDuplicateUrls: false,
} satisfies Omit<CoordinatorConfig, "storage">;

/**
 * Top-level default for documentation / test seeds. The `storage` key under
 * `coordinator` is intentionally absent because no useful global default
 * exists — see {@link DEFAULT_COORDINATOR_CONFIG}.
 */
export const DEFAULT_BROWSERHIVE_CONFIG = {
  port: 8080,
  coordinator: DEFAULT_COORDINATOR_CONFIG,
} satisfies Omit<BrowserHiveConfig, "coordinator"> & {
  coordinator: typeof DEFAULT_COORDINATOR_CONFIG;
};
