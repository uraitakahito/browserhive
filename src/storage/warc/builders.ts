/**
 * Record builders. These produce `WarcRecord` values that callers can hand
 * to `WarcWriter.writeRecord`. The split keeps `writer.ts` free of
 * spec-domain concerns (digest scheme, header layout, CDP-isms) and keeps
 * the builders pure / unit-testable without spinning up a `WriteStream`.
 *
 * For HTTP request/response bodies, `buildHttpRequestBytes` /
 * `buildHttpResponseBytes` produce the `application/http;msgtype=*` payload
 * the WARC spec asks for: a regular HTTP/1.1-style request or response
 * line, followed by header lines, an empty CRLF, and an optional body.
 */
import { randomUUID } from "node:crypto";
import { sha256Base32 } from "./digest.js";
import type {
  HttpHeader,
  HttpRequestBytesInput,
  HttpResponseBytesInput,
  WarcRecord,
} from "./types.js";

const CRLF = "\r\n";

/**
 * WARC-Record-ID format is `urn:uuid:<uuid>` wrapped in angle brackets. The
 * brackets matter — some WARC parsers reject the bare URN form.
 */
export const newRecordId = (): string => `<urn:uuid:${randomUUID()}>`;

/**
 * Convert a CDP-style headers object (`Record<string, string>`) into the
 * list-of-pairs form WARC needs. CDP joins repeated headers (e.g.
 * `Set-Cookie`) with `\n` inside a single value — we split them back out so
 * the resulting HTTP payload has one `Set-Cookie:` line per cookie, which
 * is what HTTP-spec-compliant parsers expect.
 */
export const cdpHeadersToList = (
  headers: Record<string, string>,
): HttpHeader[] => {
  const list: HttpHeader[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const values = value.split("\n");
    for (const v of values) {
      list.push({ name, value: v });
    }
  }
  return list;
};

/**
 * Build the `application/http;msgtype=request` payload for a `request` record.
 *
 * `path` is the request-target — typically origin-form (`/path?query`). For
 * absolute-form URIs (used in proxy requests) callers can pass the full URL.
 */
export const buildHttpRequestBytes = (
  input: HttpRequestBytesInput,
): Buffer => {
  const httpVersion = input.httpVersion ?? "HTTP/1.1";
  const lines: string[] = [`${input.method} ${input.path} ${httpVersion}`];
  for (const h of input.headers) {
    lines.push(`${h.name}: ${h.value}`);
  }
  const headerBlock = Buffer.from(lines.join(CRLF) + CRLF + CRLF, "utf-8");
  return input.body ? Buffer.concat([headerBlock, input.body]) : headerBlock;
};

/**
 * Build the `application/http;msgtype=response` payload for a `response` record.
 *
 * The status line tolerates an empty `statusText` (HTTP/2 surfaces this as
 * unset) by emitting `HTTP/1.1 200` rather than a trailing space.
 */
export const buildHttpResponseBytes = (
  input: HttpResponseBytesInput,
): Buffer => {
  const httpVersion = input.httpVersion ?? "HTTP/1.1";
  const statusText = input.statusText ?? "";
  const statusLine =
    statusText.length > 0
      ? `${httpVersion} ${String(input.status)} ${statusText}`
      : `${httpVersion} ${String(input.status)}`;
  const lines: string[] = [statusLine];
  for (const h of input.headers) {
    lines.push(`${h.name}: ${h.value}`);
  }
  const headerBlock = Buffer.from(lines.join(CRLF) + CRLF + CRLF, "utf-8");
  return input.body ? Buffer.concat([headerBlock, input.body]) : headerBlock;
};

/**
 * Encode a `application/warc-fields` body (used by `warcinfo` and `metadata`
 * records). The spec defines this as a sequence of `Field: Value CRLF`
 * lines, terminated by a CRLF. Order matters for `warcinfo` only insofar as
 * humans appreciate consistency — the writer is faithful to the order of
 * the input map.
 */
const encodeWarcFields = (fields: Record<string, string>): Buffer => {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return Buffer.from(lines.join(CRLF) + CRLF, "utf-8");
};

export interface BuildWarcInfoInput {
  recordId?: string;
  date?: string;
  /** Filename of the containing `.warc.gz` (used by some readers to verify identity). */
  filename: string;
  /** Free-form fields. Common entries: `software`, `format`, `conformsTo`, `description`, `isPartOf`. */
  fields: Record<string, string>;
}

export const buildWarcInfoRecord = (
  input: BuildWarcInfoInput,
): WarcRecord => {
  const recordId = input.recordId ?? newRecordId();
  const date = input.date ?? new Date().toISOString();
  const body = encodeWarcFields(input.fields);
  return {
    headers: {
      "WARC-Type": "warcinfo",
      "WARC-Record-ID": recordId,
      "WARC-Date": date,
      "WARC-Filename": input.filename,
      "Content-Type": "application/warc-fields",
      "Content-Length": String(body.byteLength),
      "WARC-Block-Digest": sha256Base32(body),
    },
    body,
  };
};

interface BuildHttpRecordCommon {
  recordId?: string;
  date?: string;
  targetUri: string;
  /** ID of the paired record (response → request, request → response). */
  concurrentTo?: string;
  ipAddress?: string;
  /** Full `application/http` payload (built via `buildHttpRequestBytes` / `buildHttpResponseBytes`). */
  bytes: Buffer;
  /** Body-only payload for `WARC-Payload-Digest`. Optional. */
  payload?: Buffer;
}

const buildHttpRecord = (
  type: "request" | "response",
  input: BuildHttpRecordCommon,
): WarcRecord => {
  const recordId = input.recordId ?? newRecordId();
  const date = input.date ?? new Date().toISOString();
  const headers: Record<string, string> = {
    "WARC-Type": type,
    "WARC-Record-ID": recordId,
    "WARC-Date": date,
    "WARC-Target-URI": input.targetUri,
    "Content-Type": `application/http;msgtype=${type}`,
    "Content-Length": String(input.bytes.byteLength),
    "WARC-Block-Digest": sha256Base32(input.bytes),
  };
  if (input.concurrentTo !== undefined)
    headers["WARC-Concurrent-To"] = input.concurrentTo;
  if (input.ipAddress !== undefined)
    headers["WARC-IP-Address"] = input.ipAddress;
  if (input.payload !== undefined)
    headers["WARC-Payload-Digest"] = sha256Base32(input.payload);
  return { headers, body: input.bytes };
};

export const buildRequestRecord = (input: BuildHttpRecordCommon): WarcRecord =>
  buildHttpRecord("request", input);

export const buildResponseRecord = (
  input: BuildHttpRecordCommon,
): WarcRecord => buildHttpRecord("response", input);

export interface BuildMetadataInput {
  recordId?: string;
  date?: string;
  /** Optional — if the metadata describes a captured URL, set this. */
  targetUri?: string;
  /** Optional — if the metadata refers to another record, link by its WARC-Record-ID. */
  refersTo?: string;
  fields: Record<string, string>;
}

export const buildMetadataRecord = (
  input: BuildMetadataInput,
): WarcRecord => {
  const recordId = input.recordId ?? newRecordId();
  const date = input.date ?? new Date().toISOString();
  const body = encodeWarcFields(input.fields);
  const headers: Record<string, string> = {
    "WARC-Type": "metadata",
    "WARC-Record-ID": recordId,
    "WARC-Date": date,
    "Content-Type": "application/warc-fields",
    "Content-Length": String(body.byteLength),
    "WARC-Block-Digest": sha256Base32(body),
  };
  if (input.targetUri !== undefined)
    headers["WARC-Target-URI"] = input.targetUri;
  if (input.refersTo !== undefined) headers["WARC-Refers-To"] = input.refersTo;
  return { headers, body };
};
