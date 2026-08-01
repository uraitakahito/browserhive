import type {
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
  DiscoveryConfig,
  WaczConfig,
} from "./types.js";

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
  signingTimeoutMs: 5_000,
};

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  // No artificial delay. Raise it (or send `operationDelayMs` on a request) only
  // to watch a headless capture render — see capture/capture-page.ts.
  operationDelayMs: 0,
  // Off: a traced capture writes tens of lines into the page's own console, and
  // that is only ever wanted while watching one deliberately.
  trace: false,
  // One pass, browser cache in play. `multipass` (DPR 1 + 2, cache disabled) is
  // opt-in because it roughly doubles capture time and archive size, and only
  // pays off on sites that derive image URLs from devicePixelRatio rather than
  // declaring every candidate in `srcset` (autofetch already covers the latter).
  archiveMode: "single-pass",
  timeouts: {
    pageLoadMs: 30000,
    captureMs: 10000,
    // Layer B outer task budget. Sized to be larger than the worst-case
    // sum of inner Layer A bounds in PageCapturer.capture:
    //   pageLoad(30s) + dynamic-wait(5s) + addStyleTag(5s) + dismissBanners(5s)
    //   + behaviors(timeout 30s + idle 15s = 45s) + 3 × capture(10s) = 120s.
    //   (newPage / page.close
    //   are no longer in the sum: BrowserClient holds a single Chromium tab
    //   for the worker's whole lifetime and capture only navigates it. The
    //   3 × capture term covers PNG + WebP + HTML in the all-formats-on case;
    //   link extraction shares the same per-call budget but is rarely combined
    //   with all three.)
    // 130s leaves a ~35s buffer for un-wrapped CDP single calls (setViewport /
    // setUserAgent / setExtraHTTPHeaders) and for the redirect-aware retry in
    // runOnStableContext (see page-capturer.ts: a single helper call can burn
    // up to ~39s on screenshot/content if every attempt hits destroyed-context).
    // Layer B must always exceed the Layer A sum so that a hang in the
    // un-wrapped gap is the only thing this safety net catches — never a
    // steady-state success. Tune via --task-timeout / BROWSERHIVE_TASK_TIMEOUT_MS.
    taskTotalMs: 130000,
  },
  viewport: {
    width: 1280,
    height: 800,
    // DPR 1 by default (matches a normal display). Set to 2 for Retina-faithful
    // WACZ — the page then requests the 2x responsive-image candidates. See the
    // `deviceScaleFactor` doc on CaptureConfig.viewport.
    deviceScaleFactor: 1,
  },
  // Behavior defaults. autoscroll (lazy-load) + autofetch (srcset/data-*
  // completeness for DPR/viewport-correct replay) run by default. Bounded by
  // behaviors.timeoutMs (yield-checkpointed) so they cannot hang. Custom
  // client behaviors are off by default (opt in with --allow-custom-behaviors).
  behaviors: {
    builtins: ["autoscroll", "autofetch"],
    timeoutMs: 30000,
    allowCustom: false,
    // Site behaviors ship with the runtime and only act on the hosts their
    // isMatch() accepts, so they are on by default — that is the point of
    // bundling them. Turn off to reproduce a capture without them.
    siteBehaviors: true,
    options: {
      autoscroll: { stepDelayMs: 250, maxSteps: 40, idleTimeMs: 1000 },
      autofetch: { maxUrls: 2000 },
    },
    idleTimeMs: 1000,
    idleTimeoutMs: 15000,
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
 * absent from this object.
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
  // Enough to cover a client that polls minutes behind a burst, while staying
  // trivially small in memory. The durable record is the `.result.json`
  // manifest, so eviction loses nothing — it only turns a 200 into a 404.
  resultCacheSize: 1000,
} satisfies Omit<CoordinatorConfig, "storage">;

/**
 * Single source of truth for the default config values: `createProgram()` in
 * server-cli.ts reads it to seed the CLI defaults (`--port`, and via
 * `coordinator`, `--max-retry-count` / `--queue-poll-interval-ms`), keeping
 * those defaults defined in exactly one place. The `storage` key under
 * `coordinator` is intentionally absent because no useful global default
 * exists — see {@link DEFAULT_COORDINATOR_CONFIG}.
 */
/** Default worker-membership discovery settings (DnsRegistry refresh). */
export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  refreshMs: 10_000,
  // Absorb the DNS-registration race at boot: ~0.5+1+2+4+4 ≈ 11.5s of
  // retrying before a genuinely worker-less stack fails fatally.
  initRetryAttempts: 6,
  initRetryDelayMs: 500,
};

export const DEFAULT_BROWSERHIVE_CONFIG = {
  http: { port: 8080 },
  coordinator: DEFAULT_COORDINATOR_CONFIG,
  discovery: DEFAULT_DISCOVERY_CONFIG,
} satisfies Omit<BrowserHiveConfig, "coordinator"> & {
  coordinator: typeof DEFAULT_COORDINATOR_CONFIG;
};
