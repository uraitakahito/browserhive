/**
 * CDXJ line construction.
 *
 * The index is the one file a replay engine reads before it reads anything
 * else, and CDXJ 0.1.0 names seven properties it MUST carry. This suite exists
 * because that requirement was being broken for every bodyless response —
 * redirects included, not just the oversized ones — and nothing caught it.
 */
import { describe, expect, it } from "vitest";
import { buildCdxjIndex, buildCdxjLine, isoToCdxTimestamp, surtUrl } from "../../../src/storage/wacz/cdxj.js";
import type { RecordedResponse } from "../../../src/capture/network-recorder-types.js";

/** CDXJ 0.1.0 §"the object MUST contain the following properties". */
const REQUIRED_PROPERTIES = ["url", "digest", "mime", "filename", "offset", "length", "status"];

const rec = (overrides: Partial<RecordedResponse> = {}): RecordedResponse => ({
  url: "https://x.test/app.js",
  date: "2026-07-26T12:34:56.789Z",
  status: 200,
  mime: "application/javascript",
  payloadDigest: "sha256:AAAA",
  offset: 0,
  length: 512,
  ...overrides,
});

/** The JSON payload of a line — everything from the first `{`. */
const payloadOf = (line: string): Record<string, unknown> =>
  JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>;

describe("buildCdxjLine", () => {
  it("lays out the line as `<surt> <timestamp> <json>`", () => {
    const line = buildCdxjLine({ filename: "data.warc.gz", response: rec() });

    expect(line.startsWith("test,x)/app.js 20260726123456 {")).toBe(true);
  });

  it("carries every property CDXJ 0.1.0 requires", () => {
    const payload = payloadOf(buildCdxjLine({ filename: "data.warc.gz", response: rec() }));

    expect(Object.keys(payload).sort()).toEqual([...REQUIRED_PROPERTIES].sort());
  });

  it("still carries a digest when the response had no body", () => {
    // A response can be bodyless for several reasons — a redirect hop, a 304, a
    // body dropped by a size cap. None of them make `digest` optional: the
    // archive stored zero bytes, and zero bytes have a hash. Dropping the key
    // instead leaves an index that does not conform.
    const payload = payloadOf(
      buildCdxjLine({ filename: "data.warc.gz", response: rec({ payloadDigest: undefined }) }),
    );

    expect(Object.keys(payload).sort()).toEqual([...REQUIRED_PROPERTIES].sort());
    expect(payload["digest"]).toBe("sha256:4OYMIQUY7QOBJGX36TEJS35ZEQT24QPEMSNZGTFESWMRW6CSXBKQ");
  });

  it("emits numeric fields as strings, as pywb and wacz-creator do", () => {
    const payload = payloadOf(buildCdxjLine({ filename: "data.warc.gz", response: rec() }));

    expect(payload["status"]).toBe("200");
    expect(payload["length"]).toBe("512");
    expect(payload["offset"]).toBe("0");
  });
});

describe("buildCdxjIndex", () => {
  it("sorts lines so a range scan can binary-search them", () => {
    const body = buildCdxjIndex("data.warc.gz", [
      rec({ url: "https://x.test/z.js" }),
      rec({ url: "https://x.test/a.js" }),
    ]);

    expect(body.split("\n").filter(Boolean).map((l) => l.split(" ")[0])).toEqual([
      "test,x)/a.js",
      "test,x)/z.js",
    ]);
  });

  it("keeps one line per response rather than de-duplicating by URL", () => {
    // Two responses for the same URL is the static-ization case: replay picks
    // the one closest to the page snapshot, which it cannot do if we collapse
    // them here.
    const body = buildCdxjIndex("data.warc.gz", [
      rec({ date: "2026-07-26T12:00:00.000Z" }),
      rec({ date: "2026-07-26T12:00:05.000Z" }),
    ]);

    expect(body.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("produces nothing at all for a capture with no responses", () => {
    expect(buildCdxjIndex("data.warc.gz", [])).toBe("");
  });
});

describe("surtUrl", () => {
  it("reverses host labels so a domain's pages sort together", () => {
    expect(surtUrl("https://www.example.com/a/b?q=1")).toBe("com,example,www)/a/b?q=1");
  });

  it("passes through inputs that are not parseable URLs", () => {
    expect(surtUrl("not a url")).toBe("not a url");
  });

  it("gives a hostless scheme an empty host rather than falling through", () => {
    // `data:` parses as a URL — it just has no hostname — so it takes the
    // normal path and sorts under `)`. The doc comment above `surtUrl` claims
    // it falls back to the raw string; it does not. Recorded as-is rather than
    // changed: nothing depends on where these sort today.
    expect(surtUrl("data:text/plain,hello")).toBe(")text/plain,hello");
  });
});

describe("isoToCdxTimestamp", () => {
  it("keeps 14 digits and drops sub-second precision", () => {
    expect(isoToCdxTimestamp("2026-07-26T12:34:56.789Z")).toBe("20260726123456");
  });
});
