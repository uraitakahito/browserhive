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
}

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
});
