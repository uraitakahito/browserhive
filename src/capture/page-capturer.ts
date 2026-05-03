/**
 * Page Capturer
 *
 * Handles the actual page capture process (screenshot and/or HTML) for a single URL.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer";
import type { CaptureConfig } from "../config/index.js";
import { DEFAULT_DYNAMIC_CONTENT_WAIT_MS } from "../config/index.js";
import type { CaptureTask, CaptureResult } from "./types.js";
import { captureStatus } from "./capture-status.js";
import {
  createHttpError,
  errorDetailsFromException,
  TimeoutError,
} from "./error-details.js";
import { errorType } from "./error-type.js";
import { err, ok, type Result } from "../result.js";
import { logger } from "../logger.js";
import {
  dismissBanners,
  type DismissReport,
} from "./banner-dismisser.js";

/**
 * CSS to hide scrollbars in Chromium
 *
 * ::-webkit-scrollbar
 *   - Pseudo-element for WebKit/Blink-based browsers (Chromium)
 *   - Hides the entire scrollbar
 *   - Uses !important to ensure it overrides any page-defined styles
 */
const HIDE_SCROLLBAR_CSS = `
  ::-webkit-scrollbar { display: none !important; }
`;

/**
 * Execute a promise with a timeout. Throws `TimeoutError` (typed, carries
 * `operation` and `timeoutMs`) when the budget is exceeded.
 */
export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError({ operation, timeoutMs }));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    return result;
  } catch (error) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Layer A timeouts — per-call upper bounds on otherwise-unprotected puppeteer
// awaits inside `PageCapturer.capture`. Puppeteer does not expose a built-in
// timeout for these methods, and `page.goto({ waitUntil: "domcontentloaded" })`
// only bounds the *first* DOMContentLoaded — it does nothing for follow-up
// navigations triggered by the page itself (e.g. itochu.co.jp/ → /ja/,
// imhds.co.jp/ → /corporate/index_en.html). When such a redirect lands on a
// page that never settles (heavy SPA, third-party trackers), `page.evaluate`
// and `page.addStyleTag` await a new execution context indefinitely and the
// worker stays in `processing` forever — no exception is thrown.
//
// See `BrowserClient.process` for the outer Layer B safety net that catches
// anything the Layer A bounds below miss.
// ---------------------------------------------------------------------------

/**
 * Upper bound for `browser.newPage()`. Internally a single CDP roundtrip
 * (`Target.createTarget`), so a healthy connection completes in well under
 * a second; 10s is "definitely something is wrong" territory and lets the
 * worker recycle rather than wedge waiting on a broken connection.
 */
const NEW_PAGE_TIMEOUT_MS = 10_000;

/**
 * Upper bound for the post-load dynamic-content sleep. The inner
 * `setTimeout(resolve, DEFAULT_DYNAMIC_CONTENT_WAIT_MS)` resolves in the
 * page's execution context, but if a JS redirect tears that context down
 * mid-sleep `page.evaluate` blocks waiting for a fresh context. The 2s
 * buffer over the sleep duration covers normal context-reestablishment
 * latency; anything beyond is treated as the redirected page failing to
 * settle, which is the exact symptom that hangs the worker.
 */
const EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS = DEFAULT_DYNAMIC_CONTENT_WAIT_MS + 2_000;

/**
 * Upper bound for `page.addStyleTag` (used by `hideScrollbars`). Internally
 * uses `evaluateHandle`, so it carries the same execution-context-await
 * risk as `page.evaluate`. Pure DOM mutation with no I/O — 5s is a generous
 * ceiling for a healthy page.
 */
const STYLE_INJECTION_TIMEOUT_MS = 5_000;

/**
 * Upper bound for `page.close` in the capture-pipeline `finally`. Internally
 * a single `Target.closeTarget` CDP command (~ms on a healthy page), but on
 * a page whose execution context has already been destroyed by a JS redirect
 * (e.g. imhds.co.jp /→/corporate/index_en.html) puppeteer awaits the target
 * teardown ack indefinitely — the await never settles. Without this bound the
 * Layer A timeout that already fired in the main `try` block ends up trapped
 * here, the synthetic `CaptureResult` cannot be returned, and the entire task
 * stays pinned in `processing` until the outer Layer B (90s) wins. 5s mirrors
 * the other "single CDP call" Layer A budgets and keeps the worst-case
 * close-leak window short. Page leaks on timeout are accepted in exchange
 * for worker liveness — the Chromium target may stay open for a while, but
 * the worker is freed to drain the queue.
 */
const PAGE_CLOSE_TIMEOUT_MS = 5_000;

export const INVALID_FILENAME_CHARS_LIST = ["<", ">", ":", '"', "/", "\\", "|", "?", "*", "_"] as const;

const INVALID_FILENAME_CHARS = new RegExp(
  `[${INVALID_FILENAME_CHARS_LIST.map((c) => (c === "\\" ? "\\\\" : c)).join("")}]`
);

const INVALID_FILENAME_CHARS_DISPLAY = INVALID_FILENAME_CHARS_LIST.join(" ");

const WHITESPACE_CHARS = /\s/;
const MAX_FILENAME_LENGTH = 100;

export const validateFilename = (name: string): Result<void, string> => {
  if (name.length === 0) {
    return err(`Invalid filename "${name}": filename cannot be empty`);
  }

  if (name.length > MAX_FILENAME_LENGTH) {
    return err(
      `Invalid filename "${name}": filename exceeds ${String(MAX_FILENAME_LENGTH)} characters`,
    );
  }

  if (INVALID_FILENAME_CHARS.test(name)) {
    return err(
      `Invalid filename "${name}": contains invalid characters: ${INVALID_FILENAME_CHARS_DISPLAY}`,
    );
  }

  if (WHITESPACE_CHARS.test(name)) {
    return err(`Invalid filename "${name}": contains whitespace characters`);
  }

  return ok();
};

/** Labels separator for filename generation */
export const LABELS_SEPARATOR = "-";

export const validateLabels = (labels: string[]): Result<void, string> => {
  if (labels.length === 0) {
    return ok();
  }

  for (const label of labels) {
    const result = validateFilename(label.trim());
    if (!result.ok) {
      return result;
    }
  }

  return ok();
};

/**
 * Generate a filename for the captured file
 *
 * Format:
 * - With labels and correlationId: {taskId}_{correlationId}_{labels}.{extension}
 * - With labels only: {taskId}_{labels}.{extension}
 * - With correlationId only: {taskId}_{correlationId}.{extension}
 * - Neither: {taskId}.{extension}
 *
 * Note: labels and correlationId are expected to be pre-validated by handlers.
 */
export const generateFilename = (
  task: CaptureTask,
  extension: string
): string => {
  const parts: string[] = [task.taskId];

  if (task.correlationId) {
    parts.push(task.correlationId);
  }

  if (task.labels.length > 0) {
    parts.push(task.labels.join(LABELS_SEPARATOR));
  }

  return `${parts.join("_")}.${extension}`;
};

const configureViewport = async (page: Page, config: CaptureConfig): Promise<void> => {
  await page.setViewport({
    width: config.viewport.width,
    height: config.viewport.height,
  });
};

/**
 * Set custom User-Agent if configured
 */
export const setUserAgent = async (
  page: Page,
  userAgent: string | undefined
): Promise<void> => {
  if (userAgent !== undefined) {
    await page.setUserAgent({ userAgent });
  }
};

export const setAcceptLanguage = async (
  page: Page,
  acceptLanguage: string | undefined
): Promise<void> => {
  if (acceptLanguage !== undefined) {
    await page.setExtraHTTPHeaders({
      "Accept-Language": acceptLanguage,
    });
  }
};

/**
 * Hide scrollbars by injecting CSS
 */
export const hideScrollbars = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: HIDE_SCROLLBAR_CSS });
};

/**
 * Check if HTTP status code indicates success (2xx)
 */
export const isSuccessHttpStatus = (statusCode: number): boolean => {
  return statusCode >= 200 && statusCode < 300;
};

export class PageCapturer {
  private config: CaptureConfig;

  constructor(config: CaptureConfig) {
    this.config = config;
  }

  /**
   * Capture pipeline.
   *
   * Layer A defense: every otherwise-unprotected puppeteer await below is
   * bounded by a per-call `withTimeout`. The reason — `page.goto` with
   * `waitUntil: "domcontentloaded"` resolves on the FIRST DOMContentLoaded,
   * but pages that perform a JS redirect (e.g. itochu.co.jp/ → /ja/,
   * imhds.co.jp/ → /corporate/index_en.html) trigger a follow-up navigation
   * that destroys the execution context. Subsequent `page.evaluate` /
   * `page.addStyleTag` calls then await a fresh context that may never
   * settle (heavy SPA, third-party trackers), and puppeteer provides no
   * built-in timeout for these methods. Without these wraps the worker
   * stays in `processing` forever — no exception is thrown, the await
   * simply never resolves — and the queue stops draining.
   *
   * `configureViewport` / `setUserAgent` / `setAcceptLanguage` are single
   * CDP calls (`Emulation.*`, `Network.setExtraHTTPHeaders`) that do not
   * await navigation and complete in microseconds; intentionally not
   * wrapped.
   *
   * See `BrowserClient.process` for the outer Layer B safety net that
   * catches anything that slips through here.
   */
  async capture(
    browser: Browser,
    task: CaptureTask,
    workerIndex: number
  ): Promise<CaptureResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await withTimeout(
        browser.newPage(),
        NEW_PAGE_TIMEOUT_MS,
        `newPage for ${task.url}`
      );
      await configureViewport(page, this.config);
      await setUserAgent(page, this.config.userAgent);
      await setAcceptLanguage(page, this.config.acceptLanguage);

      const response = await withTimeout(
        page.goto(task.url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeouts.pageLoad,
        }),
        this.config.timeouts.pageLoad,
        `Navigation to ${task.url}`
      );

      const httpStatusCode = response?.status() ?? 0;

      if (!isSuccessHttpStatus(httpStatusCode)) {
        const captureProcessingTimeMs = Date.now() - startTime;
        const statusText = response?.statusText();
        return {
          task,
          status: captureStatus.httpError,
          httpStatusCode,
          errorDetails: createHttpError(httpStatusCode, statusText),
          captureProcessingTimeMs,
          timestamp: new Date().toISOString(),
          workerIndex,
        };
      }

      await withTimeout(
        page.evaluate(
          (waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
          DEFAULT_DYNAMIC_CONTENT_WAIT_MS
        ),
        EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS,
        `Dynamic content wait for ${task.url}`
      );

      await withTimeout(
        hideScrollbars(page),
        STYLE_INJECTION_TIMEOUT_MS,
        `hideScrollbars for ${task.url}`
      );

      let dismissReport: DismissReport | undefined;
      if (task.dismissBanners) {
        dismissReport = await dismissBanners(page);
      }

      let pngPath: string | undefined;
      let jpegPath: string | undefined;
      let htmlPath: string | undefined;

      if (task.captureFormats.png) {
        pngPath = await this.captureScreenshot(page, task, "png");
      }

      if (task.captureFormats.jpeg) {
        jpegPath = await this.captureScreenshot(page, task, "jpeg");
      }

      if (task.captureFormats.html) {
        htmlPath = await this.captureHtml(page, task);
      }

      const captureProcessingTimeMs = Date.now() - startTime;

      return {
        task,
        status: captureStatus.success,
        httpStatusCode,
        captureProcessingTimeMs,
        timestamp: new Date().toISOString(),
        workerIndex,
        ...(pngPath !== undefined && { pngPath }),
        ...(jpegPath !== undefined && { jpegPath }),
        ...(htmlPath !== undefined && { htmlPath }),
        ...(dismissReport !== undefined && { dismissReport }),
      };
    } catch (error) {
      const captureProcessingTimeMs = Date.now() - startTime;
      const errorDetails = errorDetailsFromException(error);
      const isTimeout = errorDetails.type === errorType.timeout;

      return {
        task,
        status: isTimeout ? captureStatus.timeout : captureStatus.failed,
        errorDetails,
        captureProcessingTimeMs,
        timestamp: new Date().toISOString(),
        workerIndex,
      };
    } finally {
      if (page) {
        try {
          await withTimeout(
            page.close(),
            PAGE_CLOSE_TIMEOUT_MS,
            `page.close for ${task.url}`,
          );
        } catch (error) {
          // Best-effort close. If the underlying page is wedged (typical on
          // a context-destroyed redirect target), the timeout above wins and
          // we leak the Chromium page in exchange for freeing the worker.
          // Surface as warn so this is observable without failing the task.
          logger.warn(
            { err: error, url: task.url, workerIndex },
            "page.close failed or timed out (page leaked, continuing)",
          );
        }
      }
    }
  }

  private async captureScreenshot(
    page: Page,
    task: CaptureTask,
    type: "png" | "jpeg"
  ): Promise<string> {
    const filename = generateFilename(task, type);
    const filePath = join(this.config.outputDir, filename);

    const options = {
      fullPage: this.config.screenshot.fullPage,
      type,
      ...(type === "jpeg" &&
        this.config.screenshot.quality !== undefined && {
          quality: this.config.screenshot.quality,
        }),
    };

    const screenshotBuffer = await withTimeout(
      page.screenshot(options),
      this.config.timeouts.capture,
      `Screenshot (${type}) of ${task.url}`
    );

    await writeFile(filePath, screenshotBuffer);

    return filePath;
  }

  private async captureHtml(page: Page, task: CaptureTask): Promise<string> {
    const filename = generateFilename(task, "html");
    const filePath = join(this.config.outputDir, filename);

    // Get HTML content with timeout
    const html = await withTimeout(
      page.content(),
      this.config.timeouts.capture,
      `HTML capture of ${task.url}`
    );

    await writeFile(filePath, html, "utf-8");

    return filePath;
  }
}
