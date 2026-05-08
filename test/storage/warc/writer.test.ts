/**
 * WARC writer / builder unit tests.
 *
 * Verifies:
 *   - serializeWarcRecord layout (CRLF, separator, terminator)
 *   - per-record gzip independence (concatenated members decompress as the
 *     concatenation of their uncompressed payloads)
 *   - digest base32 (no padding, sha256 colon prefix)
 *   - builder happy paths for warcinfo / request / response / metadata
 *   - round-trip parse: gunzip → split records → header parse matches input
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  base32Encode,
  buildHttpRequestBytes,
  buildHttpResponseBytes,
  buildMetadataRecord,
  buildRequestRecord,
  buildResponseRecord,
  buildWarcInfoRecord,
  cdpHeadersToList,
  newRecordId,
  serializeWarcRecord,
  sha256Base32,
  WarcWriter,
} from "../../../src/storage/warc/index.js";

const CRLF = "\r\n";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bh-warc-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("base32Encode", () => {
  it("matches RFC 4648 examples (no padding)", () => {
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foob"))).toBe("MZXW6YQ");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("sha256Base32", () => {
  it("returns sha256:<base32> with the correct length", () => {
    const result = sha256Base32(Buffer.from("hello"));
    expect(result.startsWith("sha256:")).toBe(true);
    // 32 bytes -> 256 bits -> 52 base32 chars (no padding)
    expect(result.length).toBe("sha256:".length + 52);
  });

  it("is deterministic", () => {
    const a = sha256Base32(Buffer.from("payload"));
    const b = sha256Base32(Buffer.from("payload"));
    expect(a).toBe(b);
  });
});

describe("newRecordId", () => {
  it("returns a UUID URN wrapped in angle brackets", () => {
    const id = newRecordId();
    expect(id).toMatch(/^<urn:uuid:[0-9a-f-]{36}>$/);
  });

  it("is unique across calls", () => {
    expect(newRecordId()).not.toBe(newRecordId());
  });
});

describe("cdpHeadersToList", () => {
  it("converts a flat record into name/value pairs", () => {
    const out = cdpHeadersToList({
      "Content-Type": "text/html",
      Server: "nginx",
    });
    expect(out).toEqual([
      { name: "Content-Type", value: "text/html" },
      { name: "Server", value: "nginx" },
    ]);
  });

  it("splits multi-valued headers (CDP joins with \\n)", () => {
    const out = cdpHeadersToList({
      "Set-Cookie": "a=1; Path=/\nb=2; Path=/",
    });
    expect(out).toEqual([
      { name: "Set-Cookie", value: "a=1; Path=/" },
      { name: "Set-Cookie", value: "b=2; Path=/" },
    ]);
  });
});

describe("serializeWarcRecord", () => {
  it("emits version line, headers in insertion order, separator, body, terminator", () => {
    const body = Buffer.from("BODY");
    const bytes = serializeWarcRecord({
      headers: {
        "WARC-Type": "metadata",
        "WARC-Record-ID": "<urn:uuid:0>",
        "Content-Length": String(body.byteLength),
      },
      body,
    });
    const expected =
      "WARC/1.1" +
      CRLF +
      "WARC-Type: metadata" +
      CRLF +
      "WARC-Record-ID: <urn:uuid:0>" +
      CRLF +
      "Content-Length: 4" +
      CRLF +
      CRLF +
      "BODY" +
      CRLF +
      CRLF;
    expect(bytes.toString("utf-8")).toBe(expected);
  });
});

describe("buildHttpRequestBytes / buildHttpResponseBytes", () => {
  it("serializes a GET request with default HTTP/1.1", () => {
    const bytes = buildHttpRequestBytes({
      method: "GET",
      path: "/index.html",
      headers: [
        { name: "Host", value: "example.com" },
        { name: "Cookie", value: "a=1" },
      ],
    });
    expect(bytes.toString("utf-8")).toBe(
      "GET /index.html HTTP/1.1" +
        CRLF +
        "Host: example.com" +
        CRLF +
        "Cookie: a=1" +
        CRLF +
        CRLF,
    );
  });

  it("serializes a response, dropping trailing space when statusText is empty (HTTP/2)", () => {
    const bytes = buildHttpResponseBytes({
      status: 200,
      statusText: "",
      headers: [{ name: "Content-Type", value: "text/html" }],
      body: Buffer.from("<html></html>"),
    });
    const text = bytes.toString("utf-8");
    expect(text).toContain("HTTP/1.1 200" + CRLF);
    expect(text).not.toContain("HTTP/1.1 200 " + CRLF);
    expect(text.endsWith("<html></html>")).toBe(true);
  });

  it("preserves repeated header names (e.g. Set-Cookie)", () => {
    const bytes = buildHttpResponseBytes({
      status: 200,
      statusText: "OK",
      headers: [
        { name: "Set-Cookie", value: "a=1" },
        { name: "Set-Cookie", value: "b=2" },
      ],
    });
    const text = bytes.toString("utf-8");
    expect(text.split("Set-Cookie:").length - 1).toBe(2);
  });
});

describe("builders", () => {
  it("buildWarcInfoRecord populates the required headers and digest", () => {
    const record = buildWarcInfoRecord({
      filename: "data.warc.gz",
      fields: { software: "browserhive/1.0.0", format: "WARC/1.1" },
    });
    expect(record.headers["WARC-Type"]).toBe("warcinfo");
    expect(record.headers["WARC-Filename"]).toBe("data.warc.gz");
    expect(record.headers["Content-Type"]).toBe("application/warc-fields");
    expect(record.headers["Content-Length"]).toBe(
      String(record.body.byteLength),
    );
    expect(record.headers["WARC-Block-Digest"]).toBe(
      sha256Base32(record.body),
    );
    expect(record.body.toString("utf-8")).toContain("software: browserhive/1.0.0");
    expect(record.body.toString("utf-8")).toContain("format: WARC/1.1");
  });

  it("buildRequestRecord / buildResponseRecord wire WARC-Concurrent-To and digests", () => {
    const requestBytes = buildHttpRequestBytes({
      method: "GET",
      path: "/",
      headers: [{ name: "Host", value: "example.com" }],
    });
    const responseBody = Buffer.from("<html></html>");
    const responseBytes = buildHttpResponseBytes({
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "text/html" }],
      body: responseBody,
    });

    const requestId = newRecordId();
    const responseId = newRecordId();
    const date = "2026-01-01T00:00:00.000Z";

    const requestRecord = buildRequestRecord({
      recordId: requestId,
      concurrentTo: responseId,
      date,
      targetUri: "https://example.com/",
      bytes: requestBytes,
    });
    const responseRecord = buildResponseRecord({
      recordId: responseId,
      concurrentTo: requestId,
      date,
      targetUri: "https://example.com/",
      bytes: responseBytes,
      payload: responseBody,
    });

    expect(requestRecord.headers["WARC-Type"]).toBe("request");
    expect(requestRecord.headers["WARC-Concurrent-To"]).toBe(responseId);
    expect(requestRecord.headers["Content-Type"]).toBe(
      "application/http;msgtype=request",
    );
    expect(requestRecord.headers["WARC-Block-Digest"]).toBe(
      sha256Base32(requestBytes),
    );

    expect(responseRecord.headers["WARC-Type"]).toBe("response");
    expect(responseRecord.headers["WARC-Concurrent-To"]).toBe(requestId);
    expect(responseRecord.headers["Content-Type"]).toBe(
      "application/http;msgtype=response",
    );
    expect(responseRecord.headers["WARC-Payload-Digest"]).toBe(
      sha256Base32(responseBody),
    );
    expect(responseRecord.headers["WARC-Block-Digest"]).toBe(
      sha256Base32(responseBytes),
    );
  });

  it("buildMetadataRecord links via WARC-Refers-To when provided", () => {
    const refersTo = newRecordId();
    const record = buildMetadataRecord({
      refersTo,
      fields: { truncated: "too-large", omittedBytes: "1048576" },
    });
    expect(record.headers["WARC-Type"]).toBe("metadata");
    expect(record.headers["WARC-Refers-To"]).toBe(refersTo);
    expect(record.body.toString("utf-8")).toContain("truncated: too-large");
  });
});

describe("WarcWriter", () => {
  it("writes records as independent gzip members; gunzip yields concatenated raw records", async () => {
    const path = join(tmpDir, "test.warc.gz");
    const writer = new WarcWriter(path);

    const info = buildWarcInfoRecord({
      filename: "test.warc.gz",
      fields: { software: "browserhive-test/0" },
    });
    const requestBytes = buildHttpRequestBytes({
      method: "GET",
      path: "/",
      headers: [{ name: "Host", value: "example.com" }],
    });
    const request = buildRequestRecord({
      targetUri: "https://example.com/",
      bytes: requestBytes,
    });

    await writer.writeRecord(info);
    await writer.writeRecord(request);
    const result = await writer.finalize();

    expect(result.path).toBe(path);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const gz = readFileSync(path);
    // Concatenated gzip members decompress as the concatenation of payloads.
    const decompressed = gunzipSync(gz).toString("utf-8");
    expect(decompressed).toContain("WARC-Type: warcinfo");
    expect(decompressed).toContain("WARC-Filename: test.warc.gz");
    expect(decompressed).toContain("WARC-Type: request");
    expect(decompressed).toContain("GET / HTTP/1.1");
    // Every record ends with the CRLFCRLF terminator.
    expect(decompressed.endsWith(CRLF + CRLF)).toBe(true);
  });

  it("records all bytes written so callers can enforce per-task size caps", async () => {
    const path = join(tmpDir, "size.warc.gz");
    const writer = new WarcWriter(path);
    await writer.writeRecord(
      buildMetadataRecord({ fields: { hello: "world" } }),
    );
    const before = readFileSync(path).byteLength;
    const result = await writer.finalize();
    expect(result.bytesWritten).toBe(before);
  });

  it("throws on writeRecord after finalize", async () => {
    const path = join(tmpDir, "done.warc.gz");
    const writer = new WarcWriter(path);
    await writer.writeRecord(
      buildMetadataRecord({ fields: { a: "b" } }),
    );
    await writer.finalize();
    await expect(
      writer.writeRecord(
        buildMetadataRecord({ fields: { c: "d" } }),
      ),
    ).rejects.toThrow(/finalized/);
  });

  it("destroy() is a no-throw best-effort cleanup", () => {
    const path = join(tmpDir, "destroy.warc.gz");
    const writer = new WarcWriter(path);
    expect(() => {
      writer.destroy();
    }).not.toThrow();
    // Idempotent
    expect(() => {
      writer.destroy();
    }).not.toThrow();
  });
});

describe("WARC round-trip", () => {
  it("parses gunzipped output back into discrete records with matching headers", async () => {
    const path = join(tmpDir, "rt.warc.gz");
    const writer = new WarcWriter(path);
    await writer.writeRecord(
      buildWarcInfoRecord({
        filename: "rt.warc.gz",
        fields: { software: "browserhive/round-trip" },
      }),
    );
    await writer.writeRecord(
      buildResponseRecord({
        targetUri: "https://example.com/a",
        bytes: buildHttpResponseBytes({
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "text/html" }],
          body: Buffer.from("<html>a</html>"),
        }),
      }),
    );
    await writer.writeRecord(
      buildResponseRecord({
        targetUri: "https://example.com/b",
        bytes: buildHttpResponseBytes({
          status: 404,
          statusText: "Not Found",
          headers: [{ name: "Content-Type", value: "text/plain" }],
          body: Buffer.from("missing"),
        }),
      }),
    );
    await writer.finalize();

    const decompressed = gunzipSync(readFileSync(path)).toString("utf-8");
    // Split on the WARC version line that begins each record.
    const records = decompressed
      .split("WARC/1.1" + CRLF)
      .filter((s) => s.length > 0);
    expect(records).toHaveLength(3);

    const targetUris = records
      .map((r) => /WARC-Target-URI: (.+)/.exec(r)?.[1])
      .filter((s): s is string => s !== undefined);
    expect(targetUris).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});
