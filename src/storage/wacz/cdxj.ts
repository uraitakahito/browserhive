/**
 * CDXJ (Capture Index, JSON-line variant) generator for WACZ.
 *
 * Each line: `<surt-url> <yyyymmddhhmmss> <json>`. Lines are sorted by
 * (surt, timestamp) so range queries work without loading the whole index.
 * The JSON object carries the fields ReplayWeb.page reads to seek into the
 * WARC file inside `archive/`: `url`, `mime`, `status`, `digest`, `length`,
 * `offset`, `filename`.
 *
 * **`filename` semantics:** the value is the WARC filename **relative to
 * the WACZ's `archive/` directory** (not relative to the WACZ root).
 * E.g. for `archive/data.warc.gz`, the field reads `data.warc.gz`. This
 * matches the convention `wacz-creator` and pywb produce — wabac.js (the
 * engine behind ReplayWeb.page) prepends `archive/` itself.
 *
 * **JSON value types:** numeric fields (`status`, `length`, `offset`) are
 * emitted as **strings**, matching the reference WACZ output of pywb /
 * wacz-creator. wabac.js parses both number and string forms, but the
 * string form is the documented convention.
 *
 * The Phase 6 plan uses this index for the "same URL, multiple responses"
 * case (static-ization): we never dedupe by URL — every response record
 * gets its own line, and the replay viewer picks the closest-by-timestamp
 * one for a given page snapshot.
 */
import type { RecordedResponse } from "../../capture/network-recorder-types.js";

/**
 * Convert a URL to its SURT form (Sort-friendly URI Reordering Transform).
 * Reverses the host components and lowercases them, then appends `)` and
 * the path+query unchanged. Falls back to the raw URL for opaque inputs
 * that don't parse as a `URL` (data:, blob:, mailto:, …).
 */
export const surtUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().split(".").reverse().join(",");
    return `${host})${u.pathname}${u.search}`;
  } catch {
    return url;
  }
};

/**
 * Convert an ISO 8601 timestamp into the 14-digit CDX timestamp form
 * (`yyyymmddhhmmss`). Drops sub-second precision and the `T` / `:` / `-`
 * separators.
 */
export const isoToCdxTimestamp = (iso: string): string =>
  iso.replace(/[-:T]/g, "").slice(0, 14);

export interface CdxjLineInput {
  filename: string;
  response: RecordedResponse;
}

/** Build a single CDXJ line. Trailing newline is the caller's responsibility. */
export const buildCdxjLine = (input: CdxjLineInput): string => {
  const { response } = input;
  const surt = surtUrl(response.url);
  const ts = isoToCdxTimestamp(response.date);
  // Numeric fields stringified per the wacz-creator / pywb convention.
  const json: Record<string, string> = {
    url: response.url,
    mime: response.mime,
    status: String(response.status),
    digest: response.payloadDigest ?? "",
    length: String(response.length),
    offset: String(response.offset),
    filename: input.filename,
  };
  if (response.payloadDigest === undefined) {
    delete json["digest"];
  }
  return `${surt} ${ts} ${JSON.stringify(json)}`;
};

/**
 * Build the full CDXJ index body. Lines are sorted by (surt, timestamp)
 * lexicographically — required for `bsearch`-style range scans by replay
 * tools.
 */
export const buildCdxjIndex = (
  filename: string,
  responses: RecordedResponse[],
): string => {
  const lines = responses
    .map((r) => buildCdxjLine({ filename, response: r }))
    .sort();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};
