/**
 * Public type surface for `NetworkRecorder`. Split from the implementation
 * file so callers (e.g. config types in Phase 5) can import shapes without
 * pulling in the puppeteer / CDP machinery.
 */

export interface RecordingFilters {
  /**
   * Glob patterns matched against the full URL (including scheme + host +
   * path + query). `*` is the only wildcard. Matched URLs have no records
   * written for them — the request is simply dropped from the WARC.
   *
   * Defaults bundle common analytics/ads (see `DEFAULT_BLOCK_PATTERNS`).
   */
  blockUrlPatterns: string[];
  /**
   * MIME prefixes (e.g. `video/`, `audio/`) — responses whose `mimeType`
   * starts with any of these have their body omitted, but request /
   * response metadata records are still emitted so the replay layer knows
   * the URL was hit.
   */
  skipContentTypes: string[];
}

export interface RecordingLimits {
  /**
   * Per-response body cap. Responses larger than this are recorded with the
   * body replaced by a `metadata` record (`truncated: too-large`).
   */
  maxResponseBytes: number;
  /**
   * Cumulative body cap per task. After total written body bytes exceed this
   * threshold, subsequent responses are recorded as
   * `metadata` (`truncated: task-cap`) and their body is dropped.
   */
  maxTaskBytes: number;
  /**
   * Cap on concurrently-tracked in-flight requests. Old entries are
   * evicted when this is exceeded (to bound the in-memory map).
   */
  maxPendingRequests: number;
}

/**
 * One CDXJ index entry for a `response` record written into the WARC.
 * Built by `NetworkRecorder` from `WarcRecordWriteInfo` plus the
 * response metadata it already has, so the WACZ packager doesn't need
 * to re-parse the WARC to build the index.
 */
export interface RecordedResponse {
  /** Original (post-redirect-within-request) response URL. */
  url: string;
  /** ISO 8601 timestamp the WARC `response` record was dated with. */
  date: string;
  status: number;
  /** MIME (e.g. `"text/html"`). Empty string when not known. */
  mime: string;
  /** Payload digest (`sha256:<base32>`) — `undefined` for responses without a body. */
  payloadDigest?: string;
  /** Byte offset of the gzip member in the WARC.gz file. */
  offset: number;
  /** Length of the gzip member in bytes. */
  length: number;
  /**
   * Why this response has no body, when it has none. `undefined` covers both
   * "the body is here" and "no body was ever expected" (redirect, 204) —
   * `payloadDigest` alone cannot tell those apart from a body that was dropped.
   *
   * Kept as the raw reason rather than a boolean: whether a missing body makes
   * an archive incomplete is a policy question, and it belongs to the code that
   * answers it (`analyzeCompleteness`), not to the recorder that observed it.
   */
  bodySkipReason?: "content-type" | "too-large" | "task-cap";
}

/** Statistics reported by `NetworkRecorder.stop()` for log enrichment. */
export interface RecordingStats {
  /** Successfully recorded request/response pairs. */
  totalRecorded: number;
  /** Requests dropped before the WARC ever saw them (block-list match). */
  totalBlocked: number;
  /** Responses recorded with body omitted due to content-type filter. */
  totalSkippedContentType: number;
  /** Responses recorded with body omitted because they exceeded `maxResponseBytes`. */
  totalTruncatedTooLarge: number;
  /** Responses recorded with body omitted because the per-task cumulative cap was hit. */
  totalTruncatedTaskCap: number;
  /** `loadingFailed` events seen (mostly aborts / DNS failures / blocked). */
  totalFailed: number;
  /** In-flight requests at `stop()` time (recorded as incomplete metadata). */
  totalIncomplete: number;
  /** Cumulative body bytes actually written into WARC `response` records. */
  totalBodyBytes: number;
  /**
   * A few example URLs per rejection kind, for diagnosing a broken replay.
   *
   * Bounded rather than exhaustive: a page can block thousands of URLs, and
   * what a reader needs is a handle on *what kind* of thing disappeared, not
   * the full list. The counters above already carry the magnitude.
   */
  samples: {
    blocked: string[];
    skippedContentType: string[];
    truncatedTooLarge: string[];
    truncatedTaskCap: string[];
  };
}

/** How many example URLs are kept per rejection kind. */
export const SAMPLE_LIMIT = 5;

/** Append `url` while under `SAMPLE_LIMIT`; a no-op once the sample is full. */
export const pushSample = (into: string[], url: string): void => {
  if (into.length < SAMPLE_LIMIT) into.push(url);
};

export interface NetworkRecorderOptions {
  taskId: string;
  /** Filename embedded in the WARC's `warcinfo` record. */
  warcFilename: string;
  /** Where the WARC should land on local disk. */
  warcPath: string;
  filters: RecordingFilters;
  limits: RecordingLimits;
  /** Software identifier for `warcinfo` (e.g. `"browserhive/1.0.0"`). */
  software: string;
  /** Optional task description for the warcinfo record. */
  description?: string;
}

export const createEmptyRecordingStats = (): RecordingStats => ({
  totalRecorded: 0,
  totalBlocked: 0,
  totalSkippedContentType: 0,
  totalTruncatedTooLarge: 0,
  totalTruncatedTaskCap: 0,
  totalFailed: 0,
  totalIncomplete: 0,
  totalBodyBytes: 0,
  samples: {
    blocked: [],
    skippedContentType: [],
    truncatedTooLarge: [],
    truncatedTaskCap: [],
  },
});

/**
 * What the browser saw of the TLS connection to one host.
 *
 * Not proof of origin. A certificate is public — anyone can fetch one and
 * present a copy — so holding these fields says nothing about who answered.
 * They are kept for two narrower things: `issuer` shows whether the
 * connection was intercepted, and the validity window can be checked against
 * a claimed capture time.
 */
export interface ObservedTls {
  /** e.g. `"TLS 1.3"`. */
  protocol: string;
  cipher: string;
  /** Subject common name, as the browser reports it. */
  subject: string;
  /** The one field that changes when a connection is intercepted. */
  issuer: string;
  /** ISO 8601. CDP reports epoch seconds; converted here so the archive is uniform. */
  validFrom: string;
  validTo: string;
  /**
   * Key into the chain store, when the chain was retrievable.
   *
   * Absent rather than empty when it was not: the observation above came from
   * the response event and still holds, and conflating "no chain" with "no
   * TLS" would lose the part that catches interception.
   */
  chainRef?: string;
}

/**
 * Certificate chains, keyed by the hash of the chain itself.
 *
 * Deduplicated because hosts share certificates: measured on one capture, 15
 * hosts presented 3 distinct chains — 53.3 KB stored per host against 12.8 KB
 * stored once each. Each value is base64 DER, leaf first, exactly as CDP
 * returned it.
 */
export type CertificateChains = Record<string, string[]>;

/**
 * Per-host TLS observations for a capture.
 *
 * A host is absent when it was never reached over HTTPS, and `null` when it
 * was but nothing came back — omitting the key in that case would read as
 * "this host was plain HTTP", which is a different fact.
 */
export type ObservedTlsByHost = Record<string, ObservedTls | null>;
