import type {
  CaptureConfig,
  CoordinatorConfig,
  BrowserHiveConfig,
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

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  timeouts: {
    pageLoad: 30000,
    capture: 10000,
    // Layer B outer task budget. Sized to be larger than the worst-case
    // sum of inner Layer A bounds in PageCapturer.capture:
    //   pageLoad(30s) + dynamic-wait(5s) + addStyleTag(5s) + dismissBanners(5s)
    //   + 4 × capture(10s) = 85s. (newPage / page.close are no longer in the
    //   sum: BrowserClient holds a single Chromium tab for the worker's whole
    //   lifetime and capture only navigates it. The 4 × capture term covers
    //   PNG + JPEG + HTML + PDF in the all-formats-on case; link extraction
    //   shares the same per-call budget but is rarely combined with all four.)
    // 100s leaves a 15s buffer for un-wrapped CDP single calls (setViewport /
    // setUserAgent / setExtraHTTPHeaders) and for the redirect-aware retry in
    // runOnStableContext (see page-capturer.ts: a single helper call can burn
    // up to ~39s on screenshot/content/pdf if every attempt hits destroyed-context).
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
