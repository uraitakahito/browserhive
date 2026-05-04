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
 *
 * Persistent page model: each BrowserClient owns a single Chromium tab
 * (`currentPage`) for the worker's entire lifetime, acquired in
 * `connect()` and released in `disconnect()`. Capture tasks navigate
 * this same tab instead of opening a new one per task — chromium-server-docker
 * starts with one tab already open, and reusing it eliminates a per-task
 * `newPage` round trip. See `acquirePage` for the WHY behind the manual
 * `puppeteer-extra` plugin firing on the initial tab.
 */
import type { Browser, Page } from "puppeteer";
import connectBrowser, { puppeteerExtra } from "../browser.js";
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
  /**
   * The Chromium tab this client owns for its entire lifetime. Acquired in
   * `connect()` (preferring the upstream's pre-existing initial tab over
   * `newPage()`) and released in `disconnect()`. Subsequent capture tasks
   * navigate this same page instead of opening a new tab per task.
   */
  private currentPage: Page | null = null;
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
   *
   * Page acquisition: prefer the upstream Chromium's pre-existing initial
   * tab over `newPage()`. chromium-server-docker starts with one tab
   * already open, and reusing it eliminates a per-worker `newPage` round
   * trip plus the matching `page.close()` on shutdown. The resulting page
   * is held in `currentPage` for the worker's entire lifetime — capture
   * tasks navigate this same page rather than opening a new tab per task.
   *
   * Recovery from page-only death: when `acquirePage`'s close listener
   * has nulled `currentPage` (the tab died) but the browser-level WebSocket
   * is still intact (`this.browser !== null`), this method re-acquires a
   * page without re-running `connectBrowser`. Without this branch, the
   * coordinator's degraded retry sends CONNECT, we early-return because
   * `this.browser` is set, but `currentPage` stays null — every subsequent
   * `process()` then throws "no active page" in an infinite loop.
   */
  async connect(): Promise<Result<void, ErrorDetails>> {
    if (this.browser && this.currentPage) return ok();
    try {
      if (!this.browser) {
        const browser = await connectBrowser(this.profile);
        // Match the page-level `close` listener with a browser-level
        // `disconnected` listener: when the upstream Chromium drops the
        // CDP WebSocket (which can happen as a side-effect of closing
        // every tab — Chromium recreates the browser-level target with
        // a fresh UUID and the old WS URL is dead), null out the
        // reference so the next reconnect re-runs `connectBrowser` and
        // gets a fresh ws endpoint. Without this, holding onto a dead
        // browser handle makes `browser.pages()` reject indefinitely
        // and the coordinator's retry loop spins on the same stale ref.
        browser.on("disconnected", () => {
          if (this.browser === browser) {
            this.browser = null;
            this.currentPage = null;
          }
        });
        this.browser = browser;
      }
      this.currentPage ??= await this.acquirePage(this.browser);
      return ok();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(createConnectionError(message));
    }
  }

  /**
   * Acquire a Page that subsequent `process()` calls will navigate. Reuses
   * the upstream's existing initial tab when available, otherwise falls
   * back to `newPage()` for resilience against future chromium-server
   * configurations that don't start with an open tab.
   *
   * Death detection: a `close` listener clears `currentPage` synchronously
   * the moment Chromium tears the tab down (crash, manual close, browser
   * shutdown). The next `process()` call then observes the null and
   * surfaces a `connection` error, which the coordinator's `degraded`
   * retry actor turns into a fresh `connecting → operational` cycle —
   * re-running `connect()` and acquiring a new page from a healthy state.
   */
  private async acquirePage(browser: Browser): Promise<Page> {
    const pages = await browser.pages();
    const existing = pages[0];

    let page: Page;
    if (existing) {
      // Manually fire stealth (and any other puppeteer-extra plugin)
      // `onPageCreated` against this pre-existing tab.
      //
      // WHY this is necessary
      // ---------------------
      // `puppeteer-extra-plugin` wires its `onPageCreated` hook to the
      // browser-level `targetcreated` event in `_bindBrowserEvents`
      // (see `node_modules/puppeteer-extra-plugin/dist/index.cjs.js`,
      // line 443: `browser.on('targetcreated', this._onTargetCreated.bind(this))`).
      // That event only fires for tabs created AFTER the listener is
      // attached — i.e. AFTER `puppeteer.connect()` returns. The initial
      // tab that chromium-server-docker has already opened by the time we
      // connect was created BEFORE the listener existed, so its
      // `targetcreated` is never delivered to the plugin and
      // `onPageCreated` is never called for it.
      //
      // Without this manual call, the stealth evasions (navigator.webdriver
      // hiding, chrome.runtime spoofing, etc.) are silently absent on the
      // very page we hand to the capture pipeline — Cloudflare WAF and
      // similar bot detectors then see a vanilla puppeteer-driven Chromium
      // and block the capture. Since reusing the initial tab is the whole
      // point of the new design (avoiding per-task `newPage`), we must
      // fire `onPageCreated` ourselves here.
      //
      // The fallback `newPage()` branch below does NOT need this — the
      // tab it creates is born after `connect()`, so the regular
      // `targetcreated` path applies stealth automatically.
      //
      // Forward-compatibility: if puppeteer-extra ever starts walking
      // `browser.pages()` itself on connect, this manual loop becomes a
      // double application. Stealth's evasions today are idempotent
      // (property/prototype overwrites with the same values), so the
      // double-apply is harmless, but worth re-checking on plugin upgrade.
      //
      // The cast narrows away puppeteer-extra's `[propName: string]: any`
      // index signature on `PuppeteerExtraPlugin`, which would otherwise
      // make `plugin.onPageCreated` typed as `any` and trip
      // `@typescript-eslint/no-unsafe-call`.
      const plugins = puppeteerExtra.plugins as {
        onPageCreated?: (page: Page) => Promise<void>;
      }[];
      for (const plugin of plugins) {
        await plugin.onPageCreated?.(existing);
      }
      page = existing;
    } else {
      page = await browser.newPage();
    }

    page.on("close", () => {
      // Only clear if this is still the page we hold — avoids racing a
      // disconnect() that already nulled the field for legitimate reasons.
      if (this.currentPage === page) {
        this.currentPage = null;
      }
    });

    return page;
  }

  /**
   * The Page this client is currently operating on. Throws if accessed
   * before `connect()` or after `disconnect()` — both indicate a programmer
   * error in the worker lifecycle.
   */
  get page(): Page {
    if (!this.currentPage) {
      throw new Error(
        `BrowserClient ${String(this.index)} has no active page (not connected or already disconnected)`,
      );
    }
    return this.currentPage;
  }

  /**
   * Disconnect from the browser. Always releases the browser reference
   * (even on failure) so subsequent connects can succeed; surfaces the
   * underlying error to the caller as a Result rather than swallowing.
   *
   * Intentionally NOT wrapped in `withTimeout` even though `browser.disconnect`
   * is a CDP-roundtrip that could in principle hang on a wedged WebSocket:
   * the call sites already sit behind two outer safety nets:
   *   1. `coordinator-actors.ts:waitForWorkersToReach(isWorkerDisconnected,
   *      WORKER_SHUTDOWN_TIMEOUT_MS=5_000)` races shutdown against a 5s timer.
   *   2. `CaptureWorker.forceDisconnectClient` is invoked in parallel as a
   *      final safety net after that race resolves.
   * Adding a third bound here would only obscure those two contracts without
   * changing observable behaviour. If a future call path needs a bound and
   * those two safety nets are not in scope, wrap at that call site instead.
   */
  async disconnect(): Promise<Result<void, ErrorDetails>> {
    if (!this.browser) return ok();
    const browser = this.browser;
    this.browser = null;
    // `currentPage` is owned by `browser` — releasing the browser disposes
    // the underlying CDP connection that backs the page, so we just clear
    // our reference. No explicit `page.close()` needed (and would be wrong:
    // the upstream's initial tab should keep its session-level identity).
    this.currentPage = null;
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
   * abandoned but continues to run on the worker's persistent page until
   * the next `process()` navigates away. The Chromium tab stays open
   * (it is the worker's permanent tab) and the next task's `page.goto`
   * supersedes the wedged in-flight call. We accept this carry-over in
   * exchange for worker liveness — the alternative is to disconnect the
   * entire browser, which would also kill any in-flight work.
   *
   * Returns a synthetic `CaptureResult { status: "timeout" }` on Layer B
   * timeout instead of throwing, so the worker-loop's existing
   * `isSuccessStatus(...) === false → TASK_FAILED` path handles retry and
   * error-history accounting uniformly.
   *
   * Throws only if no active page is held (programmer error — connect()
   * was not called or disconnect() already ran).
   *
   * Page-death surfacing: if the page was alive at connect time but has
   * since been closed by Chromium (tab crash, browser-side teardown), the
   * `close` listener registered in `acquirePage` has already nulled
   * `currentPage`, and the `this.page` getter throws. We let that bubble
   * out through the worker-loop's catch, which classifies any thrown
   * error containing "closed" as `connection` via
   * `errorDetailsFromException`, sending the worker into the `error`
   * state for the coordinator's retry loop to recover. A defensive
   * `isClosed()` check covers the narrow window where the close event
   * has not yet fired but Chromium already considers the page gone
   * (e.g. immediately post-disconnect on the browser side).
   */
  async process(task: CaptureTask): Promise<CaptureResult> {
    const page = this.page;
    if (page.isClosed()) {
      throw new Error(
        `BrowserClient ${String(this.index)} page is closed (connection lost)`,
      );
    }

    const startTime = Date.now();
    const taskTotalMs = this.profile.capture.timeouts.taskTotal;
    try {
      return await withTimeout(
        this.pageCapturer.capture(page, task, this.index),
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
