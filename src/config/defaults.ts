import type { CaptureConfig, WorkerConfig, ServerConfig } from "./types.js";

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
  },
  maxRetries: 2,
  queuePollIntervalMs: 50,
  viewport: {
    width: 1280,
    height: 800,
  },
  screenshot: {
    fullPage: false,
  },
  rejectDuplicateUrls: false,
};

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  browsers: [],
  capture: DEFAULT_CAPTURE_CONFIG,
};

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 50051,
  worker: DEFAULT_WORKER_CONFIG,
};
