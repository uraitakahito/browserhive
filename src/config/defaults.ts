import type { CaptureConfig, CoordinatorConfig, BrowserHiveConfig } from "./types.js";

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
  // outputDir is a required CLI option, so it's initialized as empty string here
  // The actual value is passed from the CLI
  outputDir: "",
  timeouts: {
    pageLoad: 30000,
    capture: 10000,
    // Layer B outer task budget. Sized to be larger than the worst-case
    // sum of inner Layer A bounds in PageCapturer.capture:
    //   newPage(10s) + pageLoad(30s) + dynamic-wait(5s) + addStyleTag(5s)
    //   + dismissBanners(5s) + 3 × capture(10s) ≈ 85s.
    // 90s adds a 5s buffer for setViewport/setUserAgent/setExtraHTTPHeaders
    // and the page.close in finally. Tune via --task-timeout /
    // BROWSERHIVE_TASK_TIMEOUT_MS.
    taskTotal: 90000,
  },
  viewport: {
    width: 1280,
    height: 800,
  },
  screenshot: {
    fullPage: false,
  },
};

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  browserProfiles: [],
  maxRetryCount: 2,
  queuePollIntervalMs: 50,
  rejectDuplicateUrls: false,
};

export const DEFAULT_BROWSERHIVE_CONFIG: BrowserHiveConfig = {
  port: 8080,
  coordinator: DEFAULT_COORDINATOR_CONFIG,
};
