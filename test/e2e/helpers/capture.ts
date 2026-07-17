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

interface StatusReport {
  completed: number;
}

/**
 * Submit a capture and wait for it to reach a terminal state. `POST
 * /v1/captures` is fire-and-forget (202); the API returns no per-task result,
 * so completion is observed by the server's cumulative `completed` count
 * ticking up. Robust across retries (a task re-enters the queue between
 * attempts). Tests run serially (fileParallelism: false), so +1 == this task.
 */
export async function submitAndWait(api: string, body: Record<string, unknown>): Promise<void> {
  const before = (await getJson<StatusReport>(`${api}/v1/status`)).completed;
  const res = await fetch(`${api}/v1/captures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  await waitUntil(async () => {
    const s = await getJson<StatusReport>(`${api}/v1/status`);
    return s.completed >= before + 1;
  });
}

/** Zero meadow's per-URL hit counters and flaky state (test isolation). */
export async function resetMeadow(meadow: string): Promise<void> {
  await fetch(`${meadow}/__reset`, { method: "POST" });
}

/** meadow's per-URL request counts — the black-box evidence of browser behaviour. */
export async function meadowHits(meadow: string): Promise<Record<string, number>> {
  return getJson<Record<string, number>>(`${meadow}/__hits`);
}
