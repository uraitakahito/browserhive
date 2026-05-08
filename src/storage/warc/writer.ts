/**
 * WARC 1.1 writer.
 *
 * Each `writeRecord` call emits one **independent gzip member** so that
 * concatenating the file output yields a valid `.warc.gz` per the WARC spec.
 * The gzip format defines that concatenated members decompress as the
 * concatenation of their uncompressed payloads, which is what indexers
 * (CDXJ) rely on to seek to a specific record by byte offset.
 *
 * The writer is stream-oriented: every record is gzipped synchronously
 * (small CPU cost, predictable memory) and appended to a `WriteStream` so
 * that very large captures stay below the per-task memory cap. Synchronous
 * `gzipSync` is acceptable here because each WARC record is bounded — the
 * NetworkRecorder enforces a per-response size limit upstream.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { gzipSync } from "node:zlib";
import type { WarcRecord } from "./types.js";

/**
 * Per-record write metadata returned by `writeRecord`. Carries everything a
 * downstream CDXJ index needs (offset / length within the .warc.gz file,
 * record type, target URI, content-type, payload digest) so callers don't
 * have to re-parse the produced file to build an index.
 *
 * `recordType` is typed as `string` rather than the WarcRecordType union
 * because the field is read straight off the record's `WARC-Type` header
 * — a custom record type wouldn't widen the union, and downstream code
 * (e.g. CDXJ index generation) only filters on known values anyway.
 */
export interface WarcRecordWriteInfo {
  /** Byte offset of the gzip member's first byte in the output file. */
  offset: number;
  /** Length of the gzip member in bytes. */
  length: number;
  recordType: string;
  recordId: string;
  targetUri: string | undefined;
  contentType: string | undefined;
  payloadDigest: string | undefined;
}

const CRLF = "\r\n";
const HEADER_BODY_SEPARATOR = CRLF + CRLF;
const RECORD_TERMINATOR = CRLF + CRLF;
export const WARC_VERSION = "WARC/1.1";

/**
 * Serialize a single record to bytes (uncompressed). Layout:
 *   `WARC/1.1` CRLF
 *   Header: Value CRLF (one per header, in insertion order)
 *   CRLF (separator between headers and body)
 *   <body>
 *   CRLF CRLF (record terminator)
 */
export const serializeWarcRecord = (record: WarcRecord): Buffer => {
  const headerLines = [WARC_VERSION];
  for (const [key, value] of Object.entries(record.headers)) {
    headerLines.push(`${key}: ${value}`);
  }
  const headerBlock = Buffer.from(
    headerLines.join(CRLF) + HEADER_BODY_SEPARATOR,
    "utf-8",
  );
  const terminator = Buffer.from(RECORD_TERMINATOR, "utf-8");
  return Buffer.concat([headerBlock, record.body, terminator]);
};

/**
 * `WriteStream`-based gzipped WARC writer. Constructor opens the file
 * eagerly so callers see ENOENT / EACCES at construction time rather than
 * after a successful capture has been built up.
 *
 * Stream errors are latched into `streamError` and re-thrown on the next
 * `writeRecord` / `finalize` call so a transient I/O failure halts the
 * recording rather than silently producing a truncated file.
 */
export class WarcWriter {
  private readonly stream: WriteStream;
  private readonly filePath: string;
  private finalized = false;
  private bytesWritten = 0;
  private streamError: Error | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.stream = createWriteStream(filePath, { flags: "w" });
    this.stream.on("error", (err: Error) => {
      this.streamError = err;
    });
  }

  /**
   * Append one record (gzipped as a standalone member). Returns a
   * `WarcRecordWriteInfo` describing where the gzip member landed and the
   * core record metadata downstream tooling (CDXJ indexer) needs to build
   * an index without re-parsing the WARC.
   */
  async writeRecord(record: WarcRecord): Promise<WarcRecordWriteInfo> {
    this.assertNotFinalized();
    if (this.streamError) throw this.streamError;
    const offset = this.bytesWritten;
    const raw = serializeWarcRecord(record);
    const gzipped = gzipSync(raw);
    await new Promise<void>((resolve, reject) => {
      this.stream.write(gzipped, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.bytesWritten += gzipped.byteLength;
    return {
      offset,
      length: gzipped.byteLength,
      recordType: record.headers["WARC-Type"] ?? "",
      recordId: record.headers["WARC-Record-ID"] ?? "",
      targetUri: record.headers["WARC-Target-URI"],
      contentType: record.headers["Content-Type"],
      payloadDigest: record.headers["WARC-Payload-Digest"],
    };
  }

  /** Close the stream and return the resulting file path + total compressed size. */
  async finalize(): Promise<{ path: string; bytesWritten: number }> {
    this.assertNotFinalized();
    this.finalized = true;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        reject(err);
      };
      this.stream.once("error", onError);
      this.stream.end(() => {
        this.stream.removeListener("error", onError);
        resolve();
      });
    });
    if (this.streamError) throw this.streamError;
    return { path: this.filePath, bytesWritten: this.bytesWritten };
  }

  /**
   * Best-effort destroy for failure paths. Does not throw — callers in
   * `finally` blocks should not have to wrap this.
   */
  destroy(): void {
    if (!this.finalized) {
      this.finalized = true;
      this.stream.destroy();
    }
  }

  private assertNotFinalized(): void {
    if (this.finalized) {
      throw new Error("WarcWriter already finalized");
    }
  }
}
