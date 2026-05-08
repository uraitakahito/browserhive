/**
 * WARC 1.1 record types and the small DTOs used by the writer / builders.
 *
 * `headers` is a flat `Record<string, string>` because WARC permits arbitrary
 * `WARC-*` extension fields and a strict typed shape would push every caller
 * into the same `as Record<string, string>` cast. Insertion order is
 * preserved by JS engines (ES2015+), so the writer emits headers in the
 * order callers built them — useful for human-readable WARC files even
 * though the spec does not mandate ordering.
 */

/**
 * WARC record types this codebase emits.
 *
 * `revisit` and `resource` are recognised by the spec and our writer, but the
 * NetworkRecorder pipeline does not currently emit them. They stay in the
 * union so future passes (e.g. dedupe via revisit records) compile against
 * the existing API.
 */
export type WarcRecordType =
  | "warcinfo"
  | "request"
  | "response"
  | "revisit"
  | "metadata"
  | "resource";

export interface WarcRecord {
  /** Header lines emitted in insertion order. */
  headers: Record<string, string>;
  /** Block payload (the bytes between the header/body separator and the trailing CRLF CRLF). */
  body: Buffer;
}

/**
 * One HTTP header. WARC's `application/http` payload allows repeated names
 * (`Set-Cookie`, `Link`), so we store each occurrence separately rather than
 * collapsing them into a `Record<string, string>`.
 */
export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpRequestBytesInput {
  method: string;
  /** Request-target (path + query, e.g. `/api/v1/x?y=1`). Use `*` / origin-form per RFC 7230. */
  path: string;
  /** HTTP version. Defaults to `HTTP/1.1`. */
  httpVersion?: string;
  headers: HttpHeader[];
  body?: Buffer;
}

export interface HttpResponseBytesInput {
  status: number;
  statusText?: string;
  httpVersion?: string;
  headers: HttpHeader[];
  body?: Buffer;
}
