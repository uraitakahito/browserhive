/**
 * WACZ completeness invariant.
 *
 * "Complete" means the archive actually holds the bytes a replay will ask for.
 * The failure this guards against is the one that bit us in production: the
 * capture browser reuses its HTTP cache across tasks, revalidates a resource,
 * and the origin answers `304 Not Modified` — no body crosses the wire, so the
 * recorder has nothing to store. The WACZ then contains a bodyless shell for
 * that URL and replay cannot fetch it. It is invisible in the usual signals:
 * the request still hits the origin, nothing fails, and `waczStats` counts the
 * record as recorded.
 *
 * v1 deliberately flags exactly one pattern — **a URL that has a 304 but no
 * 200** — so it has no false positives. Responses that are legitimately
 * bodyless are NOT flagged:
 *   - redirects (301/302/…): a body is not expected;
 *   - 204 No Content: bodyless by definition;
 *   - bodies omitted on purpose by the content-type filter or the size / task
 *     caps: already counted separately in `RecordingStats`.
 *
 * This is a pure function over the records the recorder already has in memory
 * (`recorder.stop().responses`), so it needs no browser, no disk, and no ZIP
 * round-trip — which is what lets the same invariant run in fast unit tests, in
 * the e2e suite against a real archive, and in production on every capture.
 */
import type { RecordedResponse } from "../../capture/network-recorder-types.js";

export interface CompletenessReport {
  /**
   * URLs that were only ever seen as `304` — the body is absent from the
   * archive and replay cannot recover it. Sorted for stable output.
   */
  bodylessUrls: string[];
  /** True when `bodylessUrls` is empty. */
  complete: boolean;
}

/** Analyze recorded responses against the completeness invariant. */
export const analyzeCompleteness = (
  responses: RecordedResponse[],
): CompletenessReport => {
  const statusesByUrl = new Map<string, Set<number>>();
  for (const response of responses) {
    const seen = statusesByUrl.get(response.url) ?? new Set<number>();
    seen.add(response.status);
    statusesByUrl.set(response.url, seen);
  }

  const bodylessUrls = [...statusesByUrl]
    .filter(([, statuses]) => statuses.has(304) && !statuses.has(200))
    .map(([url]) => url)
    .sort();

  return { bodylessUrls, complete: bodylessUrls.length === 0 };
};
