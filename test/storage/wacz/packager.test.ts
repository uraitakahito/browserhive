/**
 * WACZ packager / index / pages / datapackage tests.
 *
 * Coverage:
 *   - SURT URL transform (host reversal, lowercasing)
 *   - CDXJ line format (sort key, timestamp, JSON shape)
 *   - pages.jsonl header + entry shape (Phase 6.1 clock-fixing contract)
 *   - datapackage.json hashes (sha256:hex distinct from WARC's base32)
 *   - End-to-end zip layout: archive/data.warc.gz + pages/pages.jsonl +
 *     indexes/index.cdxj + datapackage.json, all hashes verifiable.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import {
  surtUrl,
  isoToCdxTimestamp,
  buildCdxjLine,
  buildCdxjIndex,
  buildPagesJsonl,
  buildDatapackage,
  serializeDatapackage,
  WaczPackager,
} from "../../../src/storage/wacz/index.js";
import { sha256Hex } from "../../../src/storage/warc/index.js";
import type { RecordedResponse } from "../../../src/capture/network-recorder-types.js";
import type { WaczSigner } from "../../../src/storage/wacz/signer.js";
import type { CaptureSelfReport } from "../../../src/storage/wacz/datapackage.js";
import { SigningRequiredError } from "../../../src/storage/wacz/signer.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bh-wacz-test-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("surtUrl", () => {
  it("reverses host components and lowercases", () => {
    expect(surtUrl("https://www.Example.com/path?q=1")).toBe(
      "com,example,www)/path?q=1",
    );
  });

  it("handles a bare host without subdomain", () => {
    expect(surtUrl("https://example.com/")).toBe("com,example)/");
  });

  it("falls back to the raw URL on invalid input", () => {
    expect(surtUrl("not a url")).toBe("not a url");
  });
});

describe("isoToCdxTimestamp", () => {
  it("strips separators and sub-second precision", () => {
    expect(isoToCdxTimestamp("2026-05-08T12:34:56.789Z")).toBe(
      "20260508123456",
    );
  });
});

describe("buildCdxjLine / buildCdxjIndex", () => {
  const baseResponse = (overrides: Partial<RecordedResponse> = {}): RecordedResponse => ({
    url: "https://example.com/",
    date: "2026-05-08T12:00:00.000Z",
    status: 200,
    mime: "text/html",
    payloadDigest: "sha256:ABCD",
    offset: 0,
    length: 100,
    ...overrides,
  });

  it("emits surt + timestamp + JSON object with the canonical fields", () => {
    const line = buildCdxjLine({
      filename: "data.warc.gz",
      response: baseResponse(),
    });
    expect(line.startsWith("com,example)/ 20260508120000 ")).toBe(true);
    const json = JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>;
    expect(json["url"]).toBe("https://example.com/");
    expect(json["mime"]).toBe("text/html");
    // Numeric fields are emitted as strings per the wacz-creator / pywb
    // convention so ReplayWeb.page (wabac.js) can ingest the index without
    // type coercion surprises.
    expect(json["status"]).toBe("200");
    expect(json["digest"]).toBe("sha256:ABCD");
    expect(json["length"]).toBe("100");
    expect(json["offset"]).toBe("0");
    expect(json["filename"]).toBe("data.warc.gz");
  });

  it("still carries a digest when the payload digest is unknown", () => {
    // This used to assert the opposite — that the key was dropped. CDXJ 0.1.0
    // lists `digest` among the properties every object MUST contain, so an
    // index that omits it does not conform, and a bodyless response is not an
    // exception: it archived zero bytes, and zero bytes have a hash.
    //
    // Build directly rather than using `baseResponse()` so we don't trip
    // `exactOptionalPropertyTypes` (which forbids assigning `undefined`
    // to an optional field).
    const noDigest: RecordedResponse = {
      url: "https://example.com/",
      date: "2026-05-08T12:00:00.000Z",
      status: 200,
      mime: "text/html",
      offset: 0,
      length: 100,
    };
    const line = buildCdxjLine({ filename: "data.warc.gz", response: noDigest });
    const json = JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>;
    expect(json["digest"]).toBe("sha256:4OYMIQUY7QOBJGX36TEJS35ZEQT24QPEMSNZGTFESWMRW6CSXBKQ");
  });

  it("sorts lines lexicographically by (surt, timestamp)", () => {
    const responses: RecordedResponse[] = [
      baseResponse({ url: "https://b.example.com/", offset: 200 }),
      baseResponse({ url: "https://a.example.com/", offset: 100 }),
    ];
    const idx = buildCdxjIndex("data.warc.gz", responses);
    const lines = idx.trim().split("\n");
    expect(lines[0]?.startsWith("com,example,a)/")).toBe(true);
    expect(lines[1]?.startsWith("com,example,b)/")).toBe(true);
  });

  it("returns an empty string when there are no responses", () => {
    expect(buildCdxjIndex("data.warc.gz", [])).toBe("");
  });
});

describe("buildPagesJsonl", () => {
  it("emits a JSON header line then one entry per page", () => {
    const text = buildPagesJsonl([
      {
        id: "task-1",
        url: "https://example.com/",
        ts: "2026-05-08T12:00:00.000Z",
        title: "Example",
      },
    ]);
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(header["format"]).toBe("json-pages-1.0");
    expect(header["id"]).toBe("pages");
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(entry["id"]).toBe("task-1");
    expect(entry["url"]).toBe("https://example.com/");
    expect(entry["ts"]).toBe("2026-05-08T12:00:00.000Z");
    expect(entry["title"]).toBe("Example");
  });
});

describe("buildDatapackage / serializeDatapackage", () => {
  it("computes sha256:hex hashes for each resource", () => {
    const warcBytes = Buffer.from("WARC fake bytes");
    const pkg = buildDatapackage({
      software: "browserhive-test/0.0.0",
      created: "2026-05-08T12:00:00.000Z",
      mainPageURL: "https://example.com/",
      mainPageDate: "2026-05-08T12:00:00.000Z",
      resources: [{ path: "archive/data.warc.gz", bytes: warcBytes }],
    });
    expect(pkg.wacz_version).toBe("1.1.1");
    expect(pkg.resources).toHaveLength(1);
    const r = pkg.resources[0]!;
    expect(r.name).toBe("data.warc.gz");
    expect(r.path).toBe("archive/data.warc.gz");
    expect(r.bytes).toBe(warcBytes.byteLength);
    // Match WACZ hex digest format (NOT WARC's base32)
    expect(r.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Cross-check value against direct hashing
    const expected = createHash("sha256").update(warcBytes).digest("hex");
    expect(r.hash).toBe(`sha256:${expected}`);
  });

  it("serializes with trailing newline so reproducible builds match", () => {
    const pkg = buildDatapackage({
      software: "x",
      created: "2026-05-08T12:00:00.000Z",
      mainPageURL: "https://example.com/",
      mainPageDate: "2026-05-08T12:00:00.000Z",
      resources: [],
    });
    const bytes = serializeDatapackage(pkg);
    expect(bytes.toString("utf-8").endsWith("\n")).toBe(true);
  });
});

describe("WaczPackager.pack — end-to-end zip layout", () => {
  it("writes what the capture could not get into the archive, not just the response", async () => {
    // The point of the whole change: an archive travels and an HTTP response
    // does not. Read the ZIP, not the return value — a caller that never sees
    // the API result must still be able to ask the file whether it is whole.
    const warcPath = join(tmpDir, "data.warc.gz");
    writeFileSync(warcPath, Buffer.from("fake-warc-bytes"));
    const waczPath = join(tmpDir, "capture-report.wacz");

    await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-cov",
      pageUrl: "https://www.yahoo.co.jp/",
      pageTitle: "Yahoo",
      capturedAt: "2026-08-02T00:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses: [],
      capture: {
        build: { version: "1.15.0", revision: "1dcfc15", buildTime: "2026-08-02T05:53:09.566Z" },
        completeness: {
          bodylessUrls: ["https://example.com/cached.css"],
          truncatedUrls: [],
          complete: false,
        },
        // The measured yahoo.co.jp numbers: 40 steps at an 800px viewport,
        // stopped by the cap rather than by the end of the page.
        coverage: { scrollExhausted: true, scrollSteps: 40, scrolledPx: 32_000 },
      },
    });

    const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
    const dp = JSON.parse(Buffer.from(entries["datapackage.json"]!).toString("utf-8")) as Record<
      string,
      unknown
    >;

    expect(dp["browserhive:capture"]).toEqual({
      build: { version: "1.15.0", revision: "1dcfc15", buildTime: "2026-08-02T05:53:09.566Z" },
      completeness: {
        bodylessUrls: ["https://example.com/cached.css"],
        truncatedUrls: [],
        complete: false,
      },
      coverage: { scrollExhausted: true, scrollSteps: 40, scrolledPx: 32_000 },
    });
    // The spec fields are untouched — the new key sits beside them, and
    // wabac.js reads only config / profile / metadata / resources from here.
    expect(dp["profile"]).toBe("data-package");
    expect(dp["wacz_version"]).toBe("1.1.1");
  });

  it("records which build produced the archive, in a form a machine can read", async () => {
    // `software` is prose — py-wacz writes "py-wacz 0.4.6", Browsertrix writes
    // "Browsertrix-Crawler 1.x (with warcio.js 2.y)", Scoop writes "Scoop @
    // Harvard Library Innovation Lab v0.0.1". No two agree, and nothing parses
    // it: wabac reads only config / profile / metadata / resources from this
    // file. So the parseable copy goes here instead, beside the other things
    // this capture knows about itself.
    const warcPath = join(tmpDir, "data.warc.gz");
    writeFileSync(warcPath, Buffer.from("fake-warc-bytes"));
    const waczPath = join(tmpDir, "build.wacz");

    await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-build",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      capturedAt: "2026-08-02T00:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses: [],
      capture: {
        build: { version: "1.15.0", revision: "1dcfc15", buildTime: "2026-08-02T05:53:09.566Z" },
        completeness: { bodylessUrls: [], truncatedUrls: [], complete: true },
      },
    });

    const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
    const dp = JSON.parse(Buffer.from(entries["datapackage.json"]!).toString("utf-8")) as Record<
      string,
      unknown
    >;
    expect((dp["browserhive:capture"] as { build?: unknown }).build).toEqual({
      version: "1.15.0",
      revision: "1dcfc15",
      buildTime: "2026-08-02T05:53:09.566Z",
    });
  });

  it("omits the key entirely when the caller reported nothing", async () => {
    // An absent key and `complete: true` are different claims. Writing the
    // latter when nobody measured would be the same defect in a new place.
    const warcPath = join(tmpDir, "data.warc.gz");
    writeFileSync(warcPath, Buffer.from("fake-warc-bytes"));
    const waczPath = join(tmpDir, "no-report.wacz");

    await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-none",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      capturedAt: "2026-08-02T00:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses: [],
    });

    const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
    const dp = JSON.parse(Buffer.from(entries["datapackage.json"]!).toString("utf-8")) as Record<
      string,
      unknown
    >;
    expect(dp).not.toHaveProperty("browserhive:capture");
  });

  it("produces a zip with the four expected entries and verifiable datapackage hashes", async () => {
    // Synthesize a tiny "warc.gz" — content doesn't have to be a valid WARC for
    // the zip-layout test; the hash should match regardless.
    const warcPath = join(tmpDir, "data.warc.gz");
    const fakeWarc = Buffer.from("fake-warc-bytes-1234567890");
    writeFileSync(warcPath, fakeWarc);

    const responses: RecordedResponse[] = [
      {
        url: "https://example.com/",
        date: "2026-05-08T12:00:00.000Z",
        status: 200,
        mime: "text/html",
        payloadDigest: "sha256:ABCD",
        offset: 0,
        length: fakeWarc.byteLength,
      },
    ];

    const waczPath = join(tmpDir, "out.wacz");
    const result = await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-1",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      capturedAt: "2026-05-08T12:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses,
    });
    expect(result.path).toBe(waczPath);
    expect(result.bytes).toBeGreaterThan(0);

    // Crack the zip with fflate (sync, no IO callback gymnastics in tests).
    const zipped = readFileSync(waczPath);
    const entries = unzipSync(new Uint8Array(zipped));
    const names = Object.keys(entries).sort();
    expect(names).toEqual([
      "archive/data.warc.gz",
      "datapackage.json",
      "fuzzy.json",
      "indexes/index.cdxj",
      "pages/pages.jsonl",
    ]);

    // archive/data.warc.gz should be byte-identical to the source WARC.
    expect(Buffer.from(entries["archive/data.warc.gz"]!).equals(fakeWarc)).toBe(true);

    // pages.jsonl should contain the expected ts (Phase 6.1 clock-fixing contract).
    const pagesText = Buffer.from(entries["pages/pages.jsonl"]!).toString("utf-8");
    expect(pagesText).toContain('"ts":"2026-05-08T12:00:00.000Z"');
    expect(pagesText).toContain('"id":"task-1"');

    // CDXJ is stored plain (not gzipped) — wabac.js's loader only matches
    // `.cdx` / `.cdxj` extensions; `.cdx.gz` / `.cdxj.gz` are silently
    // skipped, leaving every URL lookup at "Archived Page Not Found".
    const cdxText = Buffer.from(entries["indexes/index.cdxj"]!).toString("utf-8");
    expect(cdxText).toMatch(/^com,example\)\/ 20260508120000 /);
    // CDXJ `filename` is the WARC name relative to `archive/`, NOT the full
    // WACZ-relative path — wabac.js prepends `archive/` itself.
    expect(cdxText).toContain('"filename":"data.warc.gz"');

    // datapackage.json hashes match the actual zip-entry bytes.
    const pkg = JSON.parse(
      Buffer.from(entries["datapackage.json"]!).toString("utf-8"),
    ) as { resources: { path: string; hash: string; bytes: number }[] };
    const findResource = (path: string): { hash: string; bytes: number } => {
      const r = pkg.resources.find((x) => x.path === path);
      if (!r) throw new Error(`resource ${path} missing`);
      return { hash: r.hash, bytes: r.bytes };
    };
    const warcResource = findResource("archive/data.warc.gz");
    expect(warcResource.hash).toBe(sha256Hex(fakeWarc));
    expect(warcResource.bytes).toBe(fakeWarc.byteLength);

    const indexBytes = Buffer.from(entries["indexes/index.cdxj"]!);
    expect(findResource("indexes/index.cdxj").hash).toBe(sha256Hex(indexBytes));

    const pagesBytes = Buffer.from(entries["pages/pages.jsonl"]!);
    expect(findResource("pages/pages.jsonl").hash).toBe(sha256Hex(pagesBytes));
  });
});

describe("WaczPackager — Phase 6 replay correctness", () => {
  it("Phase 6.1 clock fixing: pages.jsonl ts and datapackage.mainPageDate match capturedAt verbatim", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bh-wacz-clock-"));
    try {
      const warcPath = join(tmp, "data.warc.gz");
      writeFileSync(warcPath, Buffer.from("placeholder"));
      const waczPath = join(tmp, "out.wacz");
      const capturedAt = "2026-05-08T12:34:56.789Z";
      await WaczPackager.pack({
        warcPath,
        waczPath,
        taskId: "t1",
        pageUrl: "https://example.com/",
        pageTitle: "Example",
        capturedAt,
        software: "browserhive-test/0.0.0",
        responses: [],
      });
      const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
      const pagesText = Buffer.from(entries["pages/pages.jsonl"]!).toString("utf-8");
      // Page entry's `ts` is the timestamp ReplayWeb.page uses to pin
      // `Date.now()` etc. on replay — it MUST equal the capture-start time
      // verbatim or JS-computed URLs (?_=Date.now()) will mismatch.
      expect(pagesText).toContain(`"ts":"${capturedAt}"`);
      const pkg = JSON.parse(
        Buffer.from(entries["datapackage.json"]!).toString("utf-8"),
      ) as { mainPageDate: string };
      expect(pkg.mainPageDate).toBe(capturedAt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Phase 6.3 same URL multiple responses: CDXJ index keeps both, no dedupe", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bh-wacz-dedup-"));
    try {
      const warcPath = join(tmp, "data.warc.gz");
      writeFileSync(warcPath, Buffer.from("placeholder"));
      const waczPath = join(tmp, "out.wacz");
      await WaczPackager.pack({
        warcPath,
        waczPath,
        taskId: "t2",
        pageUrl: "https://example.com/",
        pageTitle: "Example",
        capturedAt: "2026-05-08T12:00:00.000Z",
        software: "browserhive-test/0.0.0",
        responses: [
          {
            url: "https://example.com/api/data",
            date: "2026-05-08T12:00:01.000Z",
            status: 200,
            mime: "application/json",
            offset: 0,
            length: 100,
          },
          {
            url: "https://example.com/api/data",
            date: "2026-05-08T12:00:05.000Z",
            status: 200,
            mime: "application/json",
            offset: 200,
            length: 110,
          },
        ],
      });
      const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
      const cdxText = Buffer.from(entries["indexes/index.cdxj"]!).toString("utf-8");
      const lines = cdxText.trim().split("\n");
      expect(lines).toHaveLength(2);
      // Both lines target the same SURT URL, ordered by timestamp.
      expect(lines.every((l) => l.startsWith("com,example)/api/data"))).toBe(true);
      expect(lines[0]).toContain("20260508120001");
      expect(lines[1]).toContain("20260508120005");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Phase 6.4 fuzzy.json: bundles strip rules for the supplied params", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bh-wacz-fuzzy-"));
    try {
      const warcPath = join(tmp, "data.warc.gz");
      writeFileSync(warcPath, Buffer.from("placeholder"));
      const waczPath = join(tmp, "out.wacz");
      await WaczPackager.pack({
        warcPath,
        waczPath,
        taskId: "t3",
        pageUrl: "https://example.com/",
        pageTitle: "Example",
        capturedAt: "2026-05-08T12:00:00.000Z",
        software: "browserhive-test/0.0.0",
        responses: [],
        fuzzyParams: ["_", "cb", "nocache"],
      });
      const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
      expect(entries["fuzzy.json"]).toBeDefined();
      const fuzzy = JSON.parse(
        Buffer.from(entries["fuzzy.json"]!).toString("utf-8"),
      ) as { rules: { rule: string; name: string }[] };
      expect(fuzzy.rules.map((r) => r.name)).toEqual(["_", "cb", "nocache"]);
      // datapackage.json should also list fuzzy.json among its resources.
      const pkg = JSON.parse(
        Buffer.from(entries["datapackage.json"]!).toString("utf-8"),
      ) as { resources: { path: string }[] };
      expect(pkg.resources.some((r) => r.path === "fuzzy.json")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Signing.
 *
 * Whether a failed signature is a failed capture is not this layer's decision —
 * it arrives as `requireSignature`, resolved from the deployment's policy and
 * the request. Both outcomes are pinned here because they are opposite in the
 * one way that matters: with a signature required, the archive must not exist
 * at all, and asserting that the call threw is not the same claim.
 *
 * The success case asserts what the signature *covers* rather than merely that
 * a file appeared. Every signer is a fake — the point of the port is that none
 * of these tests needs a network, a container, or a key.
 */
describe("WaczPackager.pack — signing", () => {
  /** The smallest self-report the packager will accept, for tests that read it back. */
  const captureReport = (signature: "required" | "none" = "none"): CaptureSelfReport => ({
    build: { version: "0.0.0", revision: "test", buildTime: "2026-08-02T00:00:00.000Z" },
    settings: {
      viewport: { width: 1280, height: 800 },
      devicePixelRatios: [1],
      cache: "clear",
      archiveMode: "single-pass",
      behaviors: [],
      signature,
    },
    completeness: { bodylessUrls: [], truncatedUrls: [], complete: true },
  });

  /** A signer that never manages to sign, whatever it is asked. */
  const alwaysFails: WaczSigner = {
    // eslint-disable-next-line @typescript-eslint/require-await -- a fake: the port is async, this stand-in has nothing to await.
    sign: async () => ({
      report: { signed: false, reason: "signing service returned 503" },
    }),
  };

  const packWith = async (
    signer: WaczSigner,
    options: {
      requireSignature?: boolean;
      waczPath?: string;
      capture?: CaptureSelfReport;
    } = {},
  ) => {
    const warcPath = join(tmpDir, "data.warc.gz");
    writeFileSync(warcPath, Buffer.from("fake-warc-bytes"));
    const waczPath = options.waczPath ?? join(tmpDir, "signed.wacz");
    const result = await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-sign",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      capturedAt: "2026-08-02T00:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses: [],
      signer,
      requireSignature: options.requireSignature ?? false,
      ...(options.capture === undefined ? {} : { capture: options.capture }),
    });
    return { result, entries: unzipSync(new Uint8Array(readFileSync(waczPath))) };
  };

  it("writes the archive unsigned when no signature was required", async () => {
    const { result, entries } = await packWith(alwaysFails);

    // Three things at once, and all three are the policy: the archive exists,
    // it carries no signature, and the reason survived.
    expect(result.bytes).toBeGreaterThan(0);
    expect(Object.keys(entries)).not.toContain("datapackage-digest.json");
    expect(result.signature).toEqual({
      signed: false,
      reason: "signing service returned 503",
    });
  });

  it("writes nothing when a required signature could not be obtained", async () => {
    const waczPath = join(tmpDir, "required.wacz");

    await expect(
      packWith(alwaysFails, { requireSignature: true, waczPath }),
    ).rejects.toThrow(SigningRequiredError);

    // The assertion that matters. Throwing after the zip is written would
    // satisfy `rejects.toThrow` and still leave an unsigned archive on disk —
    // and the upload downstream reads that file, not the return value.
    expect(existsSync(waczPath)).toBe(false);
  });

  it.each(["required", "none"] as const)(
    "carries settings.signature=%s into the archive",
    async (signature) => {
      const { entries } = await packWith(alwaysFails, {
        capture: captureReport(signature),
      });

      const pkg = JSON.parse(
        Buffer.from(entries["datapackage.json"]!).toString("utf-8"),
      ) as Record<string, { settings: { signature: string } }>;
      // Resolving this is the capture layer's job — what the packager owes is
      // that the answer reaches the file. Three years on, the digest entry
      // being absent says no signature exists; only this says whether one was
      // ever meant to.
      expect(pkg["browserhive:capture"].settings.signature).toBe(signature);
    },
  );

  it("signs the capture's self-report along with everything else", async () => {
    // The property Stage 4 depends on: whatever goes into `browserhive:capture`
    // is inside the bytes the signature covers, because the datapackage is
    // assembled before its hash is taken. That holds by construction today and
    // would stop holding silently if the order ever moved — which is why it is
    // pinned here rather than assumed.
    //
    // Asserted by re-hashing rather than by reading the digest: a test that
    // only checked "the digest names some hash" would pass with the signature
    // computed over the wrong bytes, which is the failure worth catching.
    let signedHash: string | undefined;
    const recordingSigner: WaczSigner = {
      // eslint-disable-next-line @typescript-eslint/require-await -- a fake: the port is async, this stand-in has nothing to await.
      sign: async (hash) => {
        signedHash = hash;
        return {
          digestBytes: Buffer.from(`${JSON.stringify({ path: "datapackage.json", hash })}\n`),
          report: { signed: true, domain: "sign.dev.local" },
        };
      },
    };

    const { entries } = await packWith(recordingSigner, { capture: captureReport() });

    const datapackageBytes = Buffer.from(entries["datapackage.json"]!);
    expect(datapackageBytes.toString("utf-8")).toContain("browserhive:capture");
    expect(signedHash).toBe(sha256Hex(datapackageBytes));
  });

  it("carries the signer's reason into the failure", async () => {
    await expect(
      packWith(alwaysFails, { requireSignature: true }),
    ).rejects.toThrow("signing service returned 503");
  });

  it("adds the digest and covers the datapackage that is actually in the zip", async () => {
    const fakeSigner: WaczSigner = {
      // eslint-disable-next-line @typescript-eslint/require-await -- a fake: the port is async, this stand-in has nothing to await.
      sign: async (hash) => ({
        digestBytes: Buffer.from(
          `${JSON.stringify({ path: "datapackage.json", hash })}\n`,
        ),
        report: { signed: true, domain: "sign.dev.local" },
      }),
    };

    const { result, entries } = await packWith(fakeSigner);

    expect(result.signature).toEqual({ signed: true, domain: "sign.dev.local" });
    expect(Object.keys(entries)).toContain("datapackage-digest.json");

    // The assertion that matters. "A digest file appeared" would still pass if
    // the hash were computed over the wrong bytes — and a signature over the
    // wrong bytes verifies against nothing while looking entirely correct.
    const digest = JSON.parse(
      Buffer.from(entries["datapackage-digest.json"]!).toString("utf-8"),
    ) as { path: string; hash: string };
    const datapackageBytes = Buffer.from(entries["datapackage.json"]!);
    expect(digest.path).toBe("datapackage.json");
    expect(digest.hash).toBe(sha256Hex(datapackageBytes));
  });

  it("does not sign when no signer is given", async () => {
    const warcPath = join(tmpDir, "data.warc.gz");
    writeFileSync(warcPath, Buffer.from("fake-warc-bytes"));
    const waczPath = join(tmpDir, "plain.wacz");
    const result = await WaczPackager.pack({
      warcPath,
      waczPath,
      taskId: "task-plain",
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      capturedAt: "2026-08-02T00:00:00.000Z",
      software: "browserhive-test/0.0.0",
      responses: [],
    });

    const entries = unzipSync(new Uint8Array(readFileSync(waczPath)));
    expect(Object.keys(entries)).not.toContain("datapackage-digest.json");
    expect(result.signature.signed).toBe(false);
  });
});
