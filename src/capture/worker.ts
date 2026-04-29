/**
 * Capture Worker
 *
 * Pure capture executor — connects to a remote Chromium browser and
 * processes capture tasks. State management is handled externally
 * by the worker status machine (Parent-Child Actor Model).
 */
import type { Browser } from "puppeteer";
import connectBrowser from "../browser.js";
import type { BrowserProfile } from "../config/index.js";
import { PageCapturer } from "./page-capturer.js";
import type { CaptureTask, CaptureResult, ErrorDetails } from "./types.js";
import { createConnectionError } from "./error-details.js";
import { createChildLogger, type Logger } from "../logger.js";
import { err, ok, type Result } from "../result.js";

export class Worker {
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
   * Connect to the remote browser.
   * No-op if already connected.
   * Throws on failure (caller is responsible for error handling).
   */
  async connect(): Promise<void> {
    if (this.browser) return;
    this.browser = await connectBrowser(this.profile);
  }

  /**
   * Disconnect from the browser. Always releases the browser reference
   * (even on failure) so subsequent connects can succeed; surfaces the
   * underlying error to the caller as a Result rather than swallowing.
   */
  async disconnect(): Promise<Result<undefined, ErrorDetails>> {
    if (!this.browser) return ok(undefined);
    const browser = this.browser;
    this.browser = null;
    try {
      await browser.disconnect();
      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(createConnectionError(message));
    }
  }

  /**
   * Process a capture task.
   * Delegates to PageCapturer and returns the result.
   * Throws if browser is not connected.
   */
  async process(task: CaptureTask): Promise<CaptureResult> {
    if (!this.browser) {
      throw new Error(`Worker ${String(this.index)} has no browser connection`);
    }

    return this.pageCapturer.capture(this.browser, task, this.index);
  }

  /** Whether the browser is currently connected */
  get isConnected(): boolean {
    return this.browser !== null;
  }
}
