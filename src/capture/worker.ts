/**
 * Capture Worker
 *
 * A worker that connects to a single Chromium browser and processes capture tasks.
 */
import type { Browser } from "puppeteer";
import connectBrowser from "../browser.js";
import type { BrowserOptions, CaptureConfig } from "../config/index.js";
import { PageCapturer } from "./page-capturer.js";
import type {
  CaptureTask,
  CaptureResult,
  WorkerInfo,
  ErrorRecord,
} from "./types.js";
import { WorkerStatusManager } from "./worker-status-manager.js";
import { captureStatus, isSuccessStatus } from "./capture-status.js";

const MAX_ERROR_HISTORY = 10;

export class Worker {
  private browser: Browser | null = null;
  private statusManager = new WorkerStatusManager();
  private processedCount = 0;
  private errorCount = 0;
  private errorHistory: ErrorRecord[] = [];
  private pageCapturer: PageCapturer;

  constructor(
    public readonly id: string,
    public readonly browserOptions: BrowserOptions,
    config: CaptureConfig
  ) {
    this.pageCapturer = new PageCapturer(config);
  }

  /**
   * Add error to history (FIFO, max 10 entries)
   */
  private addError(message: string, task?: CaptureTask): void {
    const record: ErrorRecord = {
      message,
      timestamp: new Date().toISOString(),
      ...(task && {
        task: {
          taskId: task.taskId,
          url: task.url,
          labels: task.labels,
        },
      }),
    };

    this.errorHistory.unshift(record);

    if (this.errorHistory.length > MAX_ERROR_HISTORY) {
      this.errorHistory.pop();
    }
  }

  async connect(): Promise<boolean> {
    try {
      this.browser = await connectBrowser(this.browserOptions);
      this.statusManager.toIdle();
      return true;
    } catch (error) {
      this.statusManager.toError();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addError(errorMessage);
      this.errorCount++;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.browser = null;
    }
    this.statusManager.toStopped();
  }

  async process(task: CaptureTask): Promise<CaptureResult> {
    if (!this.browser || !this.statusManager.canProcess) {
      return {
        task,
        status: captureStatus.failed,
        error: `Worker ${this.id} is not available (status: ${this.statusManager.current})`,
        captureProcessingTimeMs: 0,
        timestamp: new Date().toISOString(),
        workerId: this.id,
      };
    }

    this.statusManager.toBusy();

    try {
      const result = await this.pageCapturer.capture(
        this.browser,
        task,
        this.id
      );

      this.processedCount++;

      if (!isSuccessStatus(result.status)) {
        this.errorCount++;
        this.addError(result.error ?? "Unknown error", task);
      }

      return result;
    } catch (error) {
      this.errorCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addError(errorMessage, task);

      if (
        errorMessage.includes("disconnect") ||
        errorMessage.includes("closed")
      ) {
        this.statusManager.toError();
      }

      return {
        task,
        status: captureStatus.failed,
        error: errorMessage,
        captureProcessingTimeMs: 0,
        timestamp: new Date().toISOString(),
        workerId: this.id,
      };
    } finally {
      if (this.statusManager.current === "busy") {
        this.statusManager.toIdle();
      }
    }
  }

  getInfo(): WorkerInfo {
    return {
      id: this.id,
      browserOptions: this.browserOptions,
      status: this.statusManager.current,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      errorHistory: [...this.errorHistory],
    };
  }

  get isHealthy(): boolean {
    return this.browser !== null && this.statusManager.isHealthy;
  }

  get isIdle(): boolean {
    return this.statusManager.canProcess && this.isHealthy;
  }
}
