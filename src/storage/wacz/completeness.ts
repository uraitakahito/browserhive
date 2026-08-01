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
 * Two patterns are flagged, kept in separate lists because they call for
 * different responses:
 *   - **a URL with a 304 but no 200** — the origin's doing, unrecoverable here;
 *   - **a body dropped by a size cap** — ours, and a larger cap would keep it.
 *
 * Responses that are legitimately bodyless are NOT flagged:
 *   - redirects (301/302/…): a body is not expected;
 *   - 204 No Content: bodyless by definition;
 *   - bodies omitted by the content-type filter: the caller configured that
 *     filter, so the omission is the outcome they asked for.
 *
 * Neither list can produce a false positive: every entry is a body this archive
 * demonstrably does not hold.
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
  /**
   * URLs whose body this side dropped after hitting a size cap. Sorted.
   *
   * Kept apart from `bodylessUrls` because the two call for different
   * responses: a `304` is the origin's doing and nothing here can change it,
   * while a capped body is ours and raising the cap would recover it.
   */
  truncatedUrls: string[];
  /** True when both lists are empty. */
  complete: boolean;
}

/**
 * Body-skip reasons that count as an incomplete archive.
 *
 * `content-type` is excluded on purpose: that filter is empty by default and
 * only ever populated by the caller, so reporting "incomplete because you
 * asked for less" says nothing they did not already decide. The caps fire on
 * defaults, against bodies nobody chose to lose.
 */
const DROPPED_BY_CAP = new Set<RecordedResponse["bodySkipReason"]>(["too-large", "task-cap"]);

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

  const truncatedUrls = [
    ...new Set(
      responses.filter((r) => DROPPED_BY_CAP.has(r.bodySkipReason)).map((r) => r.url),
    ),
  ].sort();

  return {
    bodylessUrls,
    truncatedUrls,
    complete: bodylessUrls.length === 0 && truncatedUrls.length === 0,
  };
};
