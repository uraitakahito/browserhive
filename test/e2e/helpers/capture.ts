/**
 * Helpers for the black-box E2E suite. Everything here talks to the running
 * stack over HTTP only (no browserhive source is imported).
 */
import { expect } from "vitest";

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

/** Build a POST /v1/captures body (captureFormats is required by the API). */
export function captureRequest(
  url: string,
  formats: CaptureFormats = HTML_ONLY,
): Record<string, unknown> {
  return { url, labels: ["e2e"], captureFormats: formats };
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
 */
export async function submitAndWait(
  api: string,
  body: Record<string, unknown>,
): Promise<CaptureResultReport> {
  const res = await fetch(`${api}/v1/captures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  const { taskId } = (await res.json()) as { taskId: string };

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
  return report!;
}

/** Zero meadow's per-URL hit counters and flaky state (test isolation). */
export async function resetMeadow(meadow: string): Promise<void> {
  await fetch(`${meadow}/__reset`, { method: "POST" });
}

/** meadow's per-URL request counts — the black-box evidence of browser behaviour. */
export async function meadowHits(meadow: string): Promise<Record<string, number>> {
  return getJson<Record<string, number>>(`${meadow}/__hits`);
}
