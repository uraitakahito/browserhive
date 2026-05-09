/**
 * Page Capturer
 *
 * Handles the actual page capture process (screenshot and/or HTML) for a
 * single URL. The page is supplied by the caller (`BrowserClient` holds
 * a single persistent tab per worker) — `capture` only navigates,
 * configures, reads, and resets it; it does not create or close tabs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Page } from "puppeteer";
import type { CaptureConfig } from "../config/index.js";
import { DEFAULT_DYNAMIC_CONTENT_WAIT_MS } from "../config/index.js";
import type { ArtifactStore } from "../storage/index.js";
import { WaczPackager } from "../storage/wacz/index.js";
import type { CaptureTask, CaptureResult, LinkRecord, LinksFile } from "./types.js";
import { captureStatus } from "./capture-status.js";
import {
  createHttpError,
  errorDetailsFromException,
  isExecutionContextDestroyed,
  TimeoutError,
} from "./error-details.js";
import { errorType } from "./error-type.js";
import { err, ok, type Result } from "../result.js";
import { logger } from "../logger.js";
import {
  dismissBanners,
  type DismissReport,
} from "./banner-dismisser.js";
import type { ResetStateOptions } from "./reset-state.js";
import { NetworkRecorder } from "./network-recorder.js";
import type {
  RecordingFilters,
  RecordingLimits,
  RecordingStats,
} from "./network-recorder-types.js";

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
 * Upper bound for the post-load dynamic-content sleep. The inner
 * `setTimeout(resolve, DEFAULT_DYNAMIC_CONTENT_WAIT_MS)` resolves in the
 * page's execution context, but if a JS redirect tears that context down
 * mid-sleep `page.evaluate` blocks waiting for a fresh context. The 2s
 * buffer over the sleep duration covers normal context-reestablishment
 * latency; anything beyond is treated as the redirected page failing to
 * settle, which is the exact symptom that hangs the worker.
 *
 * NOTE: this bound is the per-attempt budget passed to `runOnStableContext`,
 * not the total time budget for the wait. The helper retries on
 * destroyed-context rejection up to `STABLE_CONTEXT_MAX_RETRIES` times, so
 * the worst-case wall-clock for this step is documented on the helper.
 */
const EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS = DEFAULT_DYNAMIC_CONTENT_WAIT_MS + 2_000;

/**
 * Upper bound for the inter-task `resetPageState` cleanup. The reset is a
 * single navigation to `about:blank` plus one CDP `Network.clearBrowserCookies`
 * roundtrip, both of which complete in well under a second on a healthy
 * connection. 5s leaves margin for a temporarily wedged tab without
 * letting a permanently wedged one block the next task.
 */
const RESET_PAGE_STATE_TIMEOUT_MS = 5_000;

/**
 * Upper bound for `page.addStyleTag` (used by `hideScrollbars`). Internally
 * uses `evaluateHandle`, so it carries the same execution-context-await
 * risk as `page.evaluate`. Pure DOM mutation with no I/O — 5s is a generous
 * ceiling for a healthy page.
 *
 * Per-attempt budget for `runOnStableContext`; see that helper for the
 * retry semantics on destroyed-context rejection.
 */
const STYLE_INJECTION_TIMEOUT_MS = 5_000;

/**
 * Upper bound for `page.waitForNavigation` after a destroyed-context catch
 * inside `runOnStableContext`.
 *
 * ## Why short and not "as long as Layer A"
 *
 * `waitForNavigation` only resolves on FUTURE navigations — events that
 * already fired are not replayed. When we catch a destroyed-context throw
 * it is genuinely unknown whether the new navigation is still in flight or
 * has already landed. We therefore bound the wait short and treat a timeout
 * here as "the redirect already finished, retry the operation immediately"
 * rather than as a failure.
 *
 * Empirically, the redirects observed in `data/js-redirect.yaml`
 * complete within ~1-2s of the initial DOMContentLoaded:
 *
 *   * https://www.imhds.co.jp/         ~1.0s redirect to /corporate/index_en.html
 *   * https://www.itochu.co.jp/        ~0.4s locale switch to /ja/
 *   * https://www.daiwahouse.com/      ~0.6s locale switch to /jp/
 *
 * 3s gives a comfortable margin while keeping the worst-case retry cost
 * predictable.
 */
const STABLE_CONTEXT_SETTLE_TIMEOUT_MS = 3_000;

/**
 * Maximum number of retries on destroyed-context inside `runOnStableContext`.
 *
 * 2 covers both single-step (most common: `/ → /ja/`) and chained two-step
 * redirects observed in production traffic. A third retry has not been
 * observed in `data/js-redirect.yaml`; if a future URL needs more, the
 * cost of bumping this is one constant. Worst-case helper-call duration
 * with these defaults is documented on `runOnStableContext` itself.
 */
const STABLE_CONTEXT_MAX_RETRIES = 2;

/**
 * Run a puppeteer operation that requires a live execution context, retrying
 * across the "Execution context was destroyed, most likely because of a
 * navigation." rejection so that JS-redirecting top pages can still be
 * captured normally.
 *
 * ## Why this helper exists
 *
 * `page.goto({ waitUntil: "domcontentloaded" })` resolves on the FIRST
 * DOMContentLoaded event of the target URL. A surprising number of
 * production top pages dispatch a follow-up client-side navigation
 * (`location.replace`, meta refresh, framework router locale negotiation, ...)
 * **immediately** after that first DOMContentLoaded. The original frame's
 * execution context is then torn down while a fresh one is constructed for
 * the redirect target. Any `page.evaluate` / `page.addStyleTag` /
 * `page.screenshot` / `page.content` invocation that lands during that gap
 * rejects with the title-quoted message — even though, from a user's
 * perspective, the redirect is **normal** behaviour and we *do* want to
 * capture the final landing page.
 *
 * Concrete URLs from `data/js-redirect.yaml` that exhibit this and
 * motivated this helper (each previously failed every attempt with
 * `internal: "Execution context was destroyed, ..."` in errorHistory,
 * never producing a screenshot):
 *
 *   * https://www.imhds.co.jp/         (3099 IsetanMitsukoshi)
 *       /  →  /corporate/index_en.html      (English landing redirect)
 *   * https://www.itochu.co.jp/        (8001 Itochu)
 *       /  →  /ja/                          (locale negotiation)
 *   * https://www.daiwahouse.com/      (1925 DaiwaHouse)
 *       /  →  /jp/                          (locale negotiation)
 *
 * ## Strategy
 *
 *  1. Run `operation` under the existing Layer A `withTimeout` so a genuine
 *     hang is still bounded by `perAttemptMs`.
 *  2. If it rejects and the rejection IS the destroyed-context signal:
 *       - Wait for the next `framenavigated` settle (`waitForNavigation`)
 *         with a short, separate budget (`STABLE_CONTEXT_SETTLE_TIMEOUT_MS`).
 *       - If `waitForNavigation` itself times out, that is fine — it means
 *         the redirect already settled before we got back here, so retry.
 *     Then retry, up to `STABLE_CONTEXT_MAX_RETRIES` extra attempts.
 *  3. If it rejects with anything else, propagate immediately (no retry).
 *
 * ## Race-safety note
 *
 * `page.waitForNavigation` resolves only on FUTURE navigations — already-
 * fired events are not replayed. There is therefore an inherent race: if
 * the redirect's DOMContentLoaded happens between the `try` block's await
 * and our `catch` block, `waitForNavigation` would otherwise hang. We
 * cannot use the canonical "register the listener BEFORE the operation"
 * pattern because we don't know up-front whether a redirect is coming.
 * The bounded settle timeout is the resolution: a missed event becomes a
 * harmless ~3s wait and an immediate retry on the now-stable context.
 *
 * ## Total time budget
 *
 * Worst case for a single helper call:
 *
 *   `(perAttemptMs + STABLE_CONTEXT_SETTLE_TIMEOUT_MS) * (1 + maxRetries)`
 *
 * With current defaults (perAttemptMs varies by call site, settle=3s,
 * maxRetries=2) the helper consumes at most:
 *
 *   * dynamic-content wait : (5s + 3s) * 3 = 24s
 *   * hideScrollbars       : (5s + 3s) * 3 = 24s
 *   * screenshot           : (10s + 3s) * 3 = 39s   (per format)
 *   * content (HTML)       : (10s + 3s) * 3 = 39s
 *
 * Layer B (`taskTotal=100s`) covers the realistic case where at most one or
 * two operations actually hit a retry; if production traffic ever drives the
 * cumulative retry budget over 100s, raise `taskTotal` rather than shrinking
 * any individual helper budget.
 *
 * ## Why `dismissBanners` is NOT routed through this helper
 *
 * `banner-dismisser.ts:dismissBanners` is best-effort by design — its catch
 * block returns an empty `DismissReport` rather than failing the capture.
 * Adding retries here would spend up to 24s on pages with no CMP banner,
 * which is the common case. The destroyed-context throw inside dismissal
 * is therefore intentionally swallowed at the dismisser level, not here.
 */
export const runOnStableContext = async <T>(
  page: Page,
  operation: () => Promise<T>,
  description: string,
  perAttemptMs: number,
  maxRetries: number = STABLE_CONTEXT_MAX_RETRIES,
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(operation(), perAttemptMs, description);
    } catch (error) {
      // Non-destroyed-context errors are real failures; do not retry.
      if (!isExecutionContextDestroyed(error)) throw error;
      // Out of retries → re-throw the most recent destroyed-context.
      // It will land in errorHistory as `internal`, which is now the
      // accurate signal that the redirect chain itself is unrecoverable
      // within our retry budget.
      if (attempt >= maxRetries) throw error;
      // Wait for the in-flight navigation to settle. Treat a timeout
      // here as "already settled" — the loop falls through to retry
      // either way. The retry attempt does NOT count this settle wait
      // against `perAttemptMs`.
      try {
        await withTimeout(
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          STABLE_CONTEXT_SETTLE_TIMEOUT_MS,
          `${description} (await navigation settle)`,
        );
      } catch {
        // Navigation already settled before we got here — proceed to retry.
      }
    }
  }
};

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

const configureViewport = async (
  page: Page,
  viewport: CaptureConfig["viewport"],
): Promise<void> => {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
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
 * Wipe per-task state from the worker's persistent page so the next task
 * starts on a clean slate.
 *
 * Why this exists
 * ---------------
 * The page is reused across every task on the same worker (see
 * `BrowserClient.connect`). Without an explicit reset, cookies set by task A
 * are visible to task B, localStorage / sessionStorage / IndexedDB written
 * by A persist into B, and DOM-attached event listeners or in-flight timers
 * from A continue running in B's context. That cross-task contamination
 * was implicitly avoided by the previous `newPage` / `page.close`-per-task
 * design; reusing one page makes it our responsibility.
 *
 * Strategy
 * --------
 * Two independently-toggleable axes (`options.cookies` / `options.pageContext`):
 *
 *  1. `pageContext`: `page.goto("about:blank")` — navigates away from the
 *     captured URL, which discards the document, fires `unload`, tears down
 *     the JS execution context (closures / timers / listeners), and drops
 *     `localStorage` / `sessionStorage` / IndexedDB references because they
 *     are origin-scoped and the new origin is `about:blank`. (Origin-scoped
 *     storage is therefore inseparable from this step; that's why the API
 *     exposes one knob, not three.)
 *  2. `cookies`: `Network.clearBrowserCookies` via CDP — cookies live on
 *     the browser, not the page, so the navigation alone doesn't drop them.
 *
 * Per-task control
 * ----------------
 * `options` is resolved at the request-mapper boundary (see
 * `src/capture/reset-state.ts:resolveResetStateSpec`) against server-side
 * defaults from `CaptureConfig.resetPageState`. Both fields false → the
 * function is an immediate no-op (no CDP session opened) and per-task
 * residue is intentionally carried over to the next task — useful for
 * stateful crawls (post-login captures, multi-page journeys against a
 * single origin).
 *
 * Best-effort
 * -----------
 * Reset failures are logged at `warn` and swallowed: a wedged page should
 * not fail the (already-completed) capture. The next task's `page.goto`
 * will supersede the in-flight reset operation either way. Stage 4 will
 * add page-death detection on top of this so a permanently wedged page
 * gets surfaced as `CONNECTION_LOST` rather than silently leaking warnings.
 */
export const resetPageState = async (
  page: Page,
  workerIndex: number,
  options: ResetStateOptions,
): Promise<void> => {
  if (!options.cookies && !options.pageContext) return;

  let session: Awaited<ReturnType<Page["createCDPSession"]>> | null = null;
  try {
    if (options.pageContext) {
      await withTimeout(
        page.goto("about:blank"),
        RESET_PAGE_STATE_TIMEOUT_MS,
        "resetPageState (about:blank)",
      );
    }
    if (options.cookies) {
      session = await page.createCDPSession();
      await withTimeout(
        session.send("Network.clearBrowserCookies"),
        RESET_PAGE_STATE_TIMEOUT_MS,
        "resetPageState (clearBrowserCookies)",
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, workerIndex },
      "resetPageState failed (best-effort, continuing)",
    );
  } finally {
    if (session) {
      try {
        await session.detach();
      } catch (error) {
        logger.warn(
          { err: error, workerIndex },
          "resetPageState CDP session detach failed",
        );
      }
    }
  }
};

/**
 * Check if HTTP status code indicates success (2xx)
 */
export const isSuccessHttpStatus = (statusCode: number): boolean => {
  return statusCode >= 200 && statusCode < 300;
};

/**
 * Read-only resolved configuration for the WACZ capture format. Phase 5
 * fills the filters / limits from CLI / env; Phase 6 adds `fuzzyParams`
 * for replay-time cache-buster handling.
 */
export interface WaczCaptureConfig {
  filters: RecordingFilters;
  limits: RecordingLimits;
  /** Software identifier embedded in the WARC `warcinfo` record + WACZ datapackage. */
  software: string;
  /** Query parameter names embedded as fuzzy-strip rules in `fuzzy.json`. */
  fuzzyParams: readonly string[];
}

export class PageCapturer {
  private config: CaptureConfig;
  private store: ArtifactStore;
  private waczConfig: WaczCaptureConfig | undefined;

  constructor(
    config: CaptureConfig,
    store: ArtifactStore,
    waczConfig?: WaczCaptureConfig,
  ) {
    this.config = config;
    this.store = store;
    this.waczConfig = waczConfig;
  }

  /**
   * Capture pipeline.
   *
   * The page is owned by the caller (`BrowserClient`), which holds a
   * single Chromium tab for the worker's entire lifetime. `capture` does
   * not create or close the page — it only navigates, configures, and
   * reads from the supplied `page`.
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
   * Redirect-aware retry: every operation that requires a live execution
   * context (`page.evaluate`, `page.addStyleTag`, `page.screenshot`,
   * `page.content`) is routed through `runOnStableContext`. That helper
   * catches the destroyed-context rejection — which is normal for
   * JS-redirecting top pages — waits for the next navigation to settle,
   * and retries. The remaining `internal` errorHistory entry for this
   * message is therefore reserved for cases where the redirect chain
   * exceeds the helper's retry budget (very rare in practice).
   *
   * `configureViewport` / `setUserAgent` / `setAcceptLanguage` are single
   * CDP calls (`Emulation.*`, `Network.setExtraHTTPHeaders`) that do not
   * await navigation and complete in microseconds; intentionally not
   * wrapped. `setAcceptLanguage` reads from `task.acceptLanguage` (per
   * request) rather than a server-wide config — its single-CDP-call cost
   * profile is unchanged whether the value is fixed or per-task.
   *
   * See `BrowserClient.process` for the outer Layer B safety net that
   * catches anything that slips through here.
   */
  async capture(
    page: Page,
    task: CaptureTask,
    workerIndex: number
  ): Promise<CaptureResult> {
    const startTime = Date.now();
    const capturedAt = new Date(startTime).toISOString();

    // WACZ recording wraps the entire capture: NetworkRecorder must be
    // attached BEFORE `page.goto` so the navigation request itself is in
    // the WARC, and detached BEFORE `resetPageState` so `about:blank` is
    // not. `tempDir` is reused for both the WARC and the WACZ output —
    // both files are read back into memory for upload, then the dir is
    // removed in `finally`.
    let recorder: NetworkRecorder | null = null;
    let waczTempDir: string | null = null;
    if (task.captureFormats.wacz) {
      if (this.waczConfig === undefined) {
        // The HTTP layer guarantees this never happens for a request that
        // sets `captureFormats.wacz = true` against a WACZ-enabled server,
        // but we surface a real error rather than a silent no-op so a
        // misconfigured deployment fails loudly.
        return {
          task,
          status: captureStatus.failed,
          errorDetails: {
            type: errorType.internal,
            message:
              "wacz capture requested but server has no WaczCaptureConfig wired up",
          },
          captureProcessingTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          workerIndex,
        };
      }
      waczTempDir = await mkdtemp(join(tmpdir(), "browserhive-wacz-"));
      recorder = new NetworkRecorder({
        taskId: task.taskId,
        warcFilename: `${task.taskId}.warc.gz`,
        warcPath: join(waczTempDir, `${task.taskId}.warc.gz`),
        software: this.waczConfig.software,
        filters: this.waczConfig.filters,
        limits: this.waczConfig.limits,
        description: `Capture of ${task.url}`,
      });
      await recorder.start(page);
    }

    try {
      await configureViewport(page, task.viewport ?? this.config.viewport);
      await setUserAgent(page, this.config.userAgent);
      await setAcceptLanguage(page, task.acceptLanguage);

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

      // JS-redirect-aware. The original frame's execution context is gone by
      // the time we get here for sites like imhds.co.jp / itochu.co.jp /
      // daiwahouse.com — see runOnStableContext for the recovery contract.
      await runOnStableContext(
        page,
        () =>
          page.evaluate(
            (waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
            DEFAULT_DYNAMIC_CONTENT_WAIT_MS,
          ),
        `Dynamic content wait for ${task.url}`,
        EVALUATE_DYNAMIC_WAIT_TIMEOUT_MS,
      );

      // Same redirect hazard as the dynamic-content wait above —
      // `addStyleTag` runs `evaluateHandle` internally and rejects with
      // destroyed-context if the redirect lands during the call.
      await runOnStableContext(
        page,
        () => hideScrollbars(page),
        `hideScrollbars for ${task.url}`,
        STYLE_INJECTION_TIMEOUT_MS,
      );

      let dismissReport: DismissReport | undefined;
      if (task.dismissOptions) {
        dismissReport = await dismissBanners(page, task.dismissOptions);
      }

      let pngLocation: string | undefined;
      let webpLocation: string | undefined;
      let htmlLocation: string | undefined;
      let linksLocation: string | undefined;
      let mhtmlLocation: string | undefined;

      if (task.captureFormats.png) {
        pngLocation = await this.captureScreenshot(page, task, "png");
      }

      if (task.captureFormats.webp) {
        webpLocation = await this.captureScreenshot(page, task, "webp");
      }

      if (task.captureFormats.html) {
        htmlLocation = await this.captureHtml(page, task);
      }

      if (task.captureFormats.links) {
        linksLocation = await this.captureLinks(page, task);
      }

      if (task.captureFormats.mhtml) {
        mhtmlLocation = await this.captureMhtml(page, task);
      }

      // WACZ packaging happens AFTER all other formats so the WARC includes
      // everything those formats requested (e.g. screenshots can drive
      // additional resource fetches via render layouts; rare but possible).
      let waczLocation: string | undefined;
      let waczStats: RecordingStats | undefined;
      if (recorder !== null && waczTempDir !== null && this.waczConfig) {
        const stopResult = await recorder.stop();
        recorder = null;
        waczStats = stopResult.stats;
        const pageTitle = await page.title().catch(() => "");
        const waczFilename = generateFilename(task, "wacz");
        const localWaczPath = join(waczTempDir, waczFilename);
        await WaczPackager.pack({
          warcPath: stopResult.path,
          waczPath: localWaczPath,
          taskId: task.taskId,
          pageUrl: task.url,
          pageTitle,
          // Anchored at capture START (the timestamp ReplayWeb.page uses to
          // pin `Date.now()` in replay JS — Phase 6.1 contract).
          capturedAt,
          software: this.waczConfig.software,
          responses: stopResult.responses,
          fuzzyParams: this.waczConfig.fuzzyParams,
        });
        const bytes = readFileSync(localWaczPath);
        waczLocation = await this.store.put(
          waczFilename,
          bytes,
          "application/wacz+zip",
        );
      }

      const captureProcessingTimeMs = Date.now() - startTime;

      return {
        task,
        status: captureStatus.success,
        httpStatusCode,
        captureProcessingTimeMs,
        timestamp: new Date().toISOString(),
        workerIndex,
        ...(pngLocation !== undefined && { pngLocation }),
        ...(webpLocation !== undefined && { webpLocation }),
        ...(htmlLocation !== undefined && { htmlLocation }),
        ...(linksLocation !== undefined && { linksLocation }),
        ...(mhtmlLocation !== undefined && { mhtmlLocation }),
        ...(waczLocation !== undefined && { waczLocation }),
        ...(waczStats !== undefined && { waczStats }),
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
      // Make sure the recorder is stopped on the failure path too — leaving
      // it attached would leak the CDP session across tasks. Also wipe the
      // temp dir whether or not the WACZ upload succeeded.
      if (recorder !== null) {
        try {
          await recorder.stop();
        } catch (err) {
          logger.warn(
            { err, taskId: task.taskId },
            "NetworkRecorder.stop on failure path raised",
          );
        }
      }
      if (waczTempDir !== null) {
        try {
          await rm(waczTempDir, { recursive: true, force: true });
        } catch (err) {
          logger.warn(
            { err, waczTempDir },
            "Failed to remove WACZ temp dir",
          );
        }
      }
      // Reset cookies / DOM context (and origin-scoped storage as a
      // side-effect of `about:blank`) BEFORE the next task arrives. The
      // recorder is intentionally stopped first so `about:blank` is NOT
      // recorded into the WARC.
      //
      // `task.resetState` is fully merged at the request-mapper boundary
      // against `CaptureConfig.resetPageState`, so this layer never has to
      // branch on undefined or merge defaults itself.
      await resetPageState(page, workerIndex, task.resetState);
    }
  }

  private async captureScreenshot(
    page: Page,
    task: CaptureTask,
    type: "png" | "webp"
  ): Promise<string> {
    const filename = generateFilename(task, type);

    const options = {
      fullPage: task.fullPage ?? this.config.screenshot.fullPage,
      type,
      ...(type === "webp" &&
        this.config.screenshot.quality !== undefined && {
          quality: this.config.screenshot.quality,
        }),
    };

    // JS-redirect-aware. `page.screenshot` walks the render tree under the
    // current execution context; if a redirect lands during the call (e.g.
    // a delayed locale switch on daiwahouse.com / itochu.co.jp) it rejects
    // with destroyed-context. The retry on the now-stable context produces
    // a screenshot of the actual landing page rather than failing the task.
    const screenshotBuffer = await runOnStableContext(
      page,
      () => page.screenshot(options),
      `Screenshot (${type}) of ${task.url}`,
      this.config.timeouts.capture,
    );

    return this.store.put(
      filename,
      Buffer.from(screenshotBuffer),
      type === "png" ? "image/png" : "image/webp",
    );
  }

  private async captureHtml(page: Page, task: CaptureTask): Promise<string> {
    const filename = generateFilename(task, "html");

    // JS-redirect-aware. `page.content` serialises the document, which
    // requires a live execution context; same redirect hazard as the
    // screenshot path above. URLs from data/js-redirect.yaml (e.g.
    // imhds.co.jp → /corporate/index_en.html) hit this every time without
    // the retry layer.
    const html = await runOnStableContext(
      page,
      () => page.content(),
      `HTML capture of ${task.url}`,
      this.config.timeouts.capture,
    );

    return this.store.put(filename, html, "text/html");
  }

  /**
   * Extract every `<a href>` from the rendered page and write the result as
   * `{taskId}_..._labels.links.json`. Same redirect hazard as the screenshot/
   * content paths — `page.evaluate` walks the DOM under the live execution
   * context, so destroyed-context rejections during a follow-up navigation
   * are recovered by `runOnStableContext`.
   *
   * Filtering is server-side (browser returns raw `a.href` already
   * absolutised against the page's base URL): drop non-http(s) schemes
   * (mailto:, javascript:, tel:, blob:, ...) and dedupe by exact href.
   */
  private async captureLinks(page: Page, task: CaptureTask): Promise<string> {
    const filename = generateFilename(task, "links.json");

    const raw = await runOnStableContext(
      page,
      () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLAnchorElement>("a[href]"),
          ).map((a) => ({
            href: a.href,
            text: a.textContent.trim().slice(0, 200),
            rel: a.rel || null,
          })),
        ),
      `Link extraction of ${task.url}`,
      this.config.timeouts.capture,
    );

    const seen = new Set<string>();
    const links: LinkRecord[] = [];
    for (const link of raw) {
      let parsed: URL;
      try {
        parsed = new URL(link.href);
      } catch {
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      links.push(link);
    }

    const file: LinksFile = {
      taskId: task.taskId,
      url: task.url,
      finalUrl: page.url(),
      labels: task.labels,
      ...(task.correlationId !== undefined && { correlationId: task.correlationId }),
      capturedAt: new Date().toISOString(),
      links,
    };

    return this.store.put(
      filename,
      JSON.stringify(file, null, 2),
      "application/json",
    );
  }

  /**
   * Capture the rendered page as an MHTML single-file archive via Chromium's
   * CDP `Page.captureSnapshot`. The resulting `multipart/related` body
   * embeds every CSS / image / font / inline script reachable from the
   * document, so the saved file renders faithfully when opened offline —
   * the raw `html` format alone breaks every relative URL.
   *
   * Same redirect hazard as the screenshot/content paths: the snapshot
   * walks the live render tree, so a JS-redirect landing during the call
   * rejects with destroyed-context. Routing through `runOnStableContext`
   * recovers the same way.
   *
   * The CDP session is detached in `finally` rather than relying on
   * worker-loop cleanup — every call site that opens a session in this
   * module follows the same pattern (see `resetPageState`).
   */
  private async captureMhtml(page: Page, task: CaptureTask): Promise<string> {
    const filename = generateFilename(task, "mhtml");
    const session = await page.createCDPSession();
    try {
      const { data } = await runOnStableContext(
        page,
        () =>
          session.send("Page.captureSnapshot", { format: "mhtml" }) as Promise<{
            data: string;
          }>,
        `MHTML capture of ${task.url}`,
        this.config.timeouts.capture,
      );
      return await this.store.put(filename, data, "multipart/related");
    } finally {
      try {
        await session.detach();
      } catch (error) {
        logger.warn(
          { err: error, taskId: task.taskId },
          "captureMhtml CDP session detach failed",
        );
      }
    }
  }
}
