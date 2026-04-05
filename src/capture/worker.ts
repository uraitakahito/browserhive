/**
 * Capture Worker
 *
 * A worker that connects to a single Chromium browser and processes capture tasks.
 */
import type { Browser } from "puppeteer";
import connectBrowser from "../browser.js";
import type { BrowserProfile } from "../config/index.js";
import { PageCapturer } from "./page-capturer.js";
import type {
  CaptureTask,
  CaptureResult,
  WorkerInfo,
  ErrorRecord,
  ErrorDetails,
} from "./types.js";
import {
  createConnectionError,
  createInternalError,
  errorDetailsFromException,
} from "./error-details.js";
import { createActor } from "xstate";
import { workerStatusMachine } from "./worker-status.js";
import { captureStatus, isSuccessStatus } from "./capture-status.js";
import { createChildLogger, type Logger } from "../logger.js";

const MAX_ERROR_HISTORY = 10;

export class Worker {
  private browser: Browser | null = null;
  private statusActor = createActor(workerStatusMachine).start();
  private processedCount = 0;
  private errorCount = 0;
  private errorHistory: ErrorRecord[] = [];
  private pageCapturer: PageCapturer;
  public readonly logger: Logger;

  public readonly index: number;
  private readonly profile: BrowserProfile;

  constructor(index: number, profile: BrowserProfile) {
    this.index = index;
    this.profile = profile;
    this.pageCapturer = new PageCapturer(profile.capture);
    this.logger = createChildLogger({ workerIndex: index, browserURL: profile.browserURL });
  }

  /**
   * Add error to history (FIFO, max 10 entries)
   */
  private addError(errorDetails: ErrorDetails, task?: CaptureTask): void {
    const record: ErrorRecord = {
      ...errorDetails,
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

  async connect(): Promise<void> {
    try {
      this.browser = await connectBrowser(this.profile);
      this.statusActor.send({ type: "TO_READY" });
    } catch (error) {
      this.statusActor.send({ type: "TO_ERROR" });
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addError(createConnectionError(errorMessage));
      this.errorCount++;
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
    if (this.statusActor.getSnapshot().can({ type: "TO_STOPPED" })) {
      this.statusActor.send({ type: "TO_STOPPED" });
    }
  }

  async process(task: CaptureTask): Promise<CaptureResult> {
    if (!this.browser || !this.isIdle) {
      return {
        task,
        status: captureStatus.failed,
        errorDetails: createInternalError(
          `Worker ${String(this.index)} is not available (status: ${this.statusActor.getSnapshot().value})`
        ),
        captureProcessingTimeMs: 0,
        timestamp: new Date().toISOString(),
        workerIndex: this.index,
      };
    }

    this.statusActor.send({ type: "TO_BUSY" });

    try {
      const result = await this.pageCapturer.capture(
        this.browser,
        task,
        this.index
      );

      this.processedCount++;

      if (!isSuccessStatus(result.status)) {
        this.errorCount++;
        this.addError(
          result.errorDetails ?? createInternalError("Unknown error"),
          task
        );
      }

      return result;
    } catch (error) {
      this.errorCount++;
      const errorDetails = errorDetailsFromException(error);
      this.addError(errorDetails, task);

      if (errorDetails.type === "connection") {
        this.statusActor.send({ type: "TO_ERROR" });
      }

      return {
        task,
        status: captureStatus.failed,
        errorDetails,
        captureProcessingTimeMs: 0,
        timestamp: new Date().toISOString(),
        workerIndex: this.index,
      };
    } finally {
      if (this.statusActor.getSnapshot().value === "busy") {
        this.statusActor.send({ type: "TO_READY" });
      }
    }
  }

  getInfo(): WorkerInfo {
    return {
      index: this.index,
      browserProfile: this.profile,
      status: this.statusActor.getSnapshot().value,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      errorHistory: [...this.errorHistory],
    };
  }

  get isOperational(): boolean {
    return this.browser !== null && this.statusActor.getSnapshot().hasTag("healthy");
  }

  get isIdle(): boolean {
    return this.browser !== null && this.statusActor.getSnapshot().hasTag("canProcess");
  }
}
