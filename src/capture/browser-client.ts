/**
 * Browser Client
 *
 * Pure capture executor — connects to a remote Chromium browser and
 * processes capture tasks. State management is handled externally
 * by the capture worker status machine (Parent-Child Actor Model).
 *
 * Public lifecycle methods (`connect`, `disconnect`) return
 * Result<void, ErrorDetails> rather than throwing, so the
 * capture worker machine can branch on the Result without `instanceof
 * Error` ad-hoc handling. `process` still throws (only when called on
 * a disconnected client, which is a programmer error).
 */
import type { Browser } from "puppeteer";
import connectBrowser from "../browser.js";
import type { BrowserProfile } from "../config/index.js";
import { captureStatus } from "./capture-status.js";
import { PageCapturer, withTimeout } from "./page-capturer.js";
import type { CaptureTask, CaptureResult, ErrorDetails } from "./types.js";
import { createConnectionError, errorDetailsFromException } from "./error-details.js";
import { errorType } from "./error-type.js";
import { createChildLogger, type Logger } from "../logger.js";
import { err, ok, type Result } from "../result.js";

export class BrowserClient {
  private browser: Browser | null = null;
  private pageCapturer: PageCapturer;
  public readonly logger: Logger;

  public readonly index: number;
  public readonly profile: BrowserProfile;

  constructor(index: number, profile: BrowserProfile) {
    this.index = index;
    this.profile = profile;
    this.pageCapturer = new PageCapturer(profile.capture);
    this.logger = createChildLogger({ workerIndex: index, browserURL: profile.browserURL });
  }

  /**
   * Connect to the remote browser. No-op if already connected.
   * Surfaces failures as Result<void, ErrorDetails> instead of
   * throwing — every connect failure is classified as `connection`,
   * which is the only semantically correct bucket for this stage.
   */
  async connect(): Promise<Result<void, ErrorDetails>> {
    if (this.browser) return ok();
    try {
      this.browser = await connectBrowser(this.profile);
      return ok();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(createConnectionError(message));
    }
  }

  /**
   * Disconnect from the browser. Always releases the browser reference
   * (even on failure) so subsequent connects can succeed; surfaces the
   * underlying error to the caller as a Result rather than swallowing.
   */
  async disconnect(): Promise<Result<void, ErrorDetails>> {
    if (!this.browser) return ok();
    const browser = this.browser;
    this.browser = null;
    try {
      await browser.disconnect();
      return ok();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(createConnectionError(message));
    }
  }

  /**
   * Process a capture task.
   *
   * Layer B safety net: the entire `pageCapturer.capture` invocation is
   * bounded by `timeouts.taskTotal`. Layer A (per-call `withTimeout`s
   * inside `PageCapturer.capture` and `dismissBanners`) catches the common
   * cases — `page.evaluate` / `page.addStyleTag` blocking on a redirected
   * page that never settles — and surfaces them with a precise error
   * message naming the operation. This outer wrap exists only as a
   * backstop for whatever Layer A misses (newly added unprotected awaits,
   * unforeseen puppeteer behaviour, a wedged CDP connection that doesn't
   * raise an error).
   *
   * On Layer B timeout the inner `pageCapturer.capture` promise is
   * abandoned but continues to run until its own finally block closes the
   * page. The remote Chromium page may stay open for a while (or
   * indefinitely if the puppeteer connection itself is wedged). We accept
   * this leak in exchange for worker liveness — the alternative is to
   * disconnect the entire browser, which would also kill in-flight
   * successful tasks on sibling pages.
   *
   * Returns a synthetic `CaptureResult { status: "timeout" }` on Layer B
   * timeout instead of throwing, so the worker-loop's existing
   * `isSuccessStatus(...) === false → TASK_FAILED` path handles retry and
   * error-history accounting uniformly.
   *
   * Throws only if browser is not connected (programmer error).
   */
  async process(task: CaptureTask): Promise<CaptureResult> {
    if (!this.browser) {
      throw new Error(`BrowserClient ${String(this.index)} has no browser connection`);
    }

    const startTime = Date.now();
    const taskTotalMs = this.profile.capture.timeouts.taskTotal;
    try {
      return await withTimeout(
        this.pageCapturer.capture(this.browser, task, this.index),
        taskTotalMs,
        `Task processing for ${task.url}`,
      );
    } catch (error) {
      const errorDetails = errorDetailsFromException(error);
      return {
        task,
        status:
          errorDetails.type === errorType.timeout
            ? captureStatus.timeout
            : captureStatus.failed,
        errorDetails,
        captureProcessingTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        workerIndex: this.index,
      };
    }
  }

  /** Whether the browser is currently connected */
  get isConnected(): boolean {
    return this.browser !== null;
  }
}
