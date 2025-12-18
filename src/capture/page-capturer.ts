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
import type { ValidationResult } from "./types.js";
import type { CaptureTask, CaptureResult } from "./types.js";
import { captureStatus } from "./capture-status.js";
import {
  createHttpError,
  errorDetailsFromException,
} from "./error-details.js";
import { errorType } from "./error-type.js";

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
 * Execute a promise with a timeout
 */
export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${message} (${String(timeoutMs)}ms)`));
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

export const INVALID_FILENAME_CHARS_LIST = ["<", ">", ":", '"', "/", "\\", "|", "?", "*", "_"] as const;

const INVALID_FILENAME_CHARS = new RegExp(
  `[${INVALID_FILENAME_CHARS_LIST.map((c) => (c === "\\" ? "\\\\" : c)).join("")}]`
);

const INVALID_FILENAME_CHARS_DISPLAY = INVALID_FILENAME_CHARS_LIST.join(" ");

const WHITESPACE_CHARS = /\s/;
const MAX_FILENAME_LENGTH = 100;

export const validateFilename = (name: string): ValidationResult => {
  if (name.length === 0) {
    return { valid: false, error: `Invalid filename "${name}": filename cannot be empty` };
  }

  if (name.length > MAX_FILENAME_LENGTH) {
    return {
      valid: false,
      error: `Invalid filename "${name}": filename exceeds ${String(MAX_FILENAME_LENGTH)} characters`,
    };
  }

  if (INVALID_FILENAME_CHARS.test(name)) {
    return {
      valid: false,
      error: `Invalid filename "${name}": contains invalid characters: ${INVALID_FILENAME_CHARS_DISPLAY}`,
    };
  }

  if (WHITESPACE_CHARS.test(name)) {
    return { valid: false, error: `Invalid filename "${name}": contains whitespace characters` };
  }

  return { valid: true };
};

/** Labels separator for filename generation */
export const LABELS_SEPARATOR = "-";

/**
 * Validate all labels in the array
 * Returns validation result for the first invalid label, or valid if all pass
 * Empty array is valid (labels are optional)
 */
export const validateLabels = (labels: string[]): ValidationResult => {
  if (labels.length === 0) {
    return { valid: true };
  }

  for (const label of labels) {
    const result = validateFilename(label.trim());
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
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
  constructor(private config: CaptureConfig) {}

  async capture(
    browser: Browser,
    task: CaptureTask,
    workerId: string
  ): Promise<CaptureResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await browser.newPage();
      await configureViewport(page, this.config);
      await setUserAgent(page, this.config.userAgent);

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
          workerId,
        };
      }

      await page.evaluate(
        (waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
        DEFAULT_DYNAMIC_CONTENT_WAIT_MS
      );

      await hideScrollbars(page);

      let pngPath: string | undefined;
      let jpegPath: string | undefined;
      let htmlPath: string | undefined;

      if (task.captureOptions.png) {
        pngPath = await this.captureScreenshot(page, task, "png");
      }

      if (task.captureOptions.jpeg) {
        jpegPath = await this.captureScreenshot(page, task, "jpeg");
      }

      if (task.captureOptions.html) {
        htmlPath = await this.captureHtml(page, task);
      }

      const captureProcessingTimeMs = Date.now() - startTime;

      return {
        task,
        status: captureStatus.success,
        httpStatusCode,
        captureProcessingTimeMs,
        timestamp: new Date().toISOString(),
        workerId,
        ...(pngPath !== undefined && { pngPath }),
        ...(jpegPath !== undefined && { jpegPath }),
        ...(htmlPath !== undefined && { htmlPath }),
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
        workerId,
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore page close errors
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
