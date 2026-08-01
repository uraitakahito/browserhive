/**
 * Helpers for the black-box E2E suite. Everything here talks to the running
 * stack over HTTP only (no browserhive source is imported).
 */
import { expect } from "vitest";
import type { TestContext } from "vitest";

/**
 * The only part of the test context this module needs.
 *
 * Taking the whole context would let helpers reach for `expect` or `task` too,
 * and then a signature no longer tells you what a helper touches. Derived from
 * `TestContext` rather than written out, so an upstream signature change breaks
 * the build instead of drifting.
 */
export type Annotate = TestContext["annotate"];

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

export interface CaptureFormats {
  png: boolean;
  webp: boolean;
  html: boolean;
  links: boolean;
  mhtml: boolean;
  wacz: boolean;
}

const HTML_ONLY: CaptureFormats = {
  png: false,
  webp: false,
  html: true,
  links: false,
  mhtml: false,
  wacz: false,
};

/** For tests that inspect the archive itself; skips the artefacts they ignore. */
export const WACZ_ONLY: CaptureFormats = {
  png: false,
  webp: false,
  html: false,
  links: false,
  mhtml: false,
  wacz: true,
};

export interface CaptureOptions {
  formats?: CaptureFormats;
  /**
   * Pause inserted before each browser operation, in milliseconds.
   *
   * Spent OUTSIDE the per-operation timeout budgets — a capture slowed down on
   * purpose is not a stuck capture. Only the whole-task budget counts it.
   */
  operationDelayMs?: number;
}

/** Build a POST /v1/captures body (captureFormats is required by the API). */
export function captureRequest(
  url: string,
  options: CaptureOptions = {},
): Record<string, unknown> {
  const { formats = HTML_ONLY, operationDelayMs } = options;
  return {
    url,
    labels: ["e2e"],
    captureFormats: formats,
    // Omitted rather than sent as undefined, so the server-side default stands
    // when a test does not care about pacing.
    ...(operationDelayMs === undefined ? {} : { operationDelayMs }),
  };
}

/** Poll `predicate` until it returns true, or throw after `timeoutMs`. */
export async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 90_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface CaptureResultReport {
  taskId: string;
  correlationId?: string;
  url: string;
  status: "success" | "failed" | "timeout" | "httpError";
  retryCount: number;
  artifacts: Partial<Record<"png" | "webp" | "html" | "links" | "mhtml" | "wacz", string>>;
  errorDetails?: { type: string; message: string };
  /** Present when `wacz` was requested and the recording finished. */
  waczStats?: {
    totalRecorded: number;
    totalTruncatedTooLarge: number;
    totalTruncatedTaskCap: number;
    totalBodyBytes: number;
  };
  /** The server's own verdict on whether the archive holds every body. */
  completeness?: {
    bodylessUrls: string[];
    truncatedUrls: string[];
    complete: boolean;
  };
}

/**
 * Submit a capture and wait for that specific task to reach a terminal state,
 * returning what became of it.
 *
 * `POST /v1/captures` is fire-and-forget (202), so completion is observed by
 * polling `GET /v1/captures/{taskId}`: 202 while the task is still queued or
 * in flight (retries included — it re-enters the queue between attempts), 200
 * once it is done. Unlike watching a cumulative counter, this tracks *this*
 * task, so it neither depends on tests running serially nor mistakes another
 * task's completion for its own.
 *
 * What the server said is annotated onto the test. Assertions in this suite are
 * about meadow's hit counters, so when one fails the first question is "did the
 * capture even succeed?" — and that answer used to be discarded along with the
 * return value. `annotate` is required rather than optional: a caller that
 * forgot it would silently lose the annotations, and the omission would only
 * surface later, while debugging a failure with nothing to go on.
 */
export async function submitAndWait(
  api: string,
  body: Record<string, unknown>,
  annotate: Annotate,
): Promise<CaptureResultReport> {
  const res = await fetch(`${api}/v1/captures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  const { taskId } = (await res.json()) as { taskId: string };

  // Annotated BEFORE polling, deliberately. The taskId is the only key tying
  // this test to the server's own log, and it is most needed exactly when
  // `waitUntil` below times out and throws — which skips everything after it.
  await annotate(`taskId=${taskId} url=${String(body["url"])}`, "capture");

  let report: CaptureResultReport | undefined;
  await waitUntil(async () => {
    const lookup = await fetch(`${api}/v1/captures/${taskId}`);
    if (lookup.status === 202) return false;
    // 404 here would mean the result was evicted before we looked, which the
    // default cache size makes impossible in a test run — surface it loudly
    // rather than spinning until the timeout.
    expect(lookup.status).toBe(200);
    report = (await lookup.json()) as CaptureResultReport;
    return true;
  });

  // The server's own verdict, independent of what meadow counted. When a hit
  // assertion fails, this separates "the browser did not do what we expected"
  // from "the capture never succeeded in the first place".
  //
  // Non-success is a "warning", not an "error": the GitHub Actions reporter
  // renders `error` as a failure annotation, and whether this test passes is
  // the assertion's call, not an annotation's.
  await annotate(
    `status=${report!.status} retryCount=${String(report!.retryCount)}`,
    report!.status === "success" ? "capture" : "warning",
  );
  if (report!.errorDetails) {
    await annotate(`${report!.errorDetails.type}: ${report!.errorDetails.message}`, "warning");
  }
  // Where the artifacts landed. Also the entry point for attaching them later.
  await annotate(JSON.stringify(report!.artifacts), "artifacts");

  return report!;
}

/** Zero meadow's per-URL request counts and failure counters (test isolation). */
export async function resetMeadow(meadow: string): Promise<void> {
  await fetch(`${meadow}/__reset`, { method: "POST" });
}

/** meadow's per-URL request counts — the black-box evidence of browser behaviour. */
export async function meadowRequestCounts(meadow: string): Promise<Record<string, number>> {
  return getJson<Record<string, number>>(`${meadow}/__request-counts`);
}
