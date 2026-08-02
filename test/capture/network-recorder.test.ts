/**
 * NetworkRecorder unit tests.
 *
 * Drives a `NetworkRecorder` through a fake CDPSession (an EventEmitter +
 * scripted `send()` responder) and inspects the resulting WARC.gz.
 *
 * Coverage focus:
 *   - request/response pair written on a happy-path GET
 *   - ExtraInfo headers override the basic event's filtered headers
 *     (Cookie / Set-Cookie / Authorization completeness — Phase 6 contract)
 *   - block-list URLs are dropped without records and counted
 *   - skipContentTypes mime prefix omits body but emits the metadata
 *   - per-response and per-task size caps emit the matching metadata
 *   - loadingFailed → metadata record + stats bump
 *   - in-flight requests at stop() are recorded as incomplete metadata
 *   - redirect (requestWillBeSent w/ redirectResponse on same requestId)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { EventEmitter } from "node:events";
import type { CDPSession } from "puppeteer";
import { NetworkRecorder } from "../../src/capture/network-recorder.js";
import type { NetworkRecorderOptions } from "../../src/capture/network-recorder-types.js";

interface FakeSession extends EventEmitter {
  send: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  detach: () => Promise<void>;
  /** Test helper to install responses for `Network.getResponseBody` per requestId. */
  setBody: (
    requestId: string,
    body: string | Buffer,
    base64Encoded?: boolean,
  ) => void;
  /** Test helper to install a thrown error for `Network.getResponseBody` per requestId. */
  setBodyError: (requestId: string, error: Error) => void;
}

const makeFakeSession = (): FakeSession => {
  const ee = new EventEmitter();
  const bodies = new Map<string, { body: string; base64Encoded: boolean }>();
  const errors = new Map<string, Error>();
  const session = ee as unknown as FakeSession;
  session.send = async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    if (method === "Network.enable") return Promise.resolve(undefined);
    if (method === "Network.getResponseBody") {
      const raw = params?.["requestId"];
      const requestId = typeof raw === "string" ? raw : "";
      const err = errors.get(requestId);
      if (err) throw err;
      const entry = bodies.get(requestId);
      if (!entry) {
        // Mimic CDP's "no resource" error so the recorder's fallback path runs.
        throw new Error(`No resource with given identifier: ${requestId}`);
      }
      return Promise.resolve(entry);
    }
    return Promise.resolve(undefined);
  };
  session.detach = (): Promise<void> => Promise.resolve();
  session.setBody = (
    requestId: string,
    body: string | Buffer,
    base64Encoded = false,
  ): void => {
    bodies.set(requestId, {
      body: typeof body === "string" ? body : body.toString("base64"),
      base64Encoded:
        base64Encoded || body instanceof Buffer ? true : base64Encoded,
    });
  };
  session.setBodyError = (requestId: string, error: Error): void => {
    errors.set(requestId, error);
  };
  return session;
};

const baseOpts = (
  warcPath: string,
  overrides: Partial<NetworkRecorderOptions> = {},
): NetworkRecorderOptions => ({
  taskId: "test-task",
  warcFilename: "test.warc.gz",
  warcPath,
  software: "browserhive-test/0.0.0",
  filters: {
    blockUrlPatterns: [],
    skipContentTypes: [],
    ...overrides.filters,
  },
  limits: {
    maxResponseBytes: 1024 * 1024,
    maxTaskBytes: 10 * 1024 * 1024,
    maxPendingRequests: 100,
    ...overrides.limits,
  },
  ...overrides,
});

const startRecorder = async (
  opts: NetworkRecorderOptions,
  session: FakeSession,
): Promise<NetworkRecorder> => {
  return NetworkRecorder.startWithSession(opts, session as unknown as CDPSession);
};

const dumpWarc = (path: string): string =>
  gunzipSync(readFileSync(path)).toString("utf-8");

const findRecord = (warc: string, predicate: (record: string) => boolean): string | undefined => {
  return warc
    .split("WARC/1.1\r\n")
    .filter((s) => s.length > 0)
    .find(predicate);
};

const findAllRecords = (
  warc: string,
  predicate: (record: string) => boolean,
): string[] => {
  return warc
    .split("WARC/1.1\r\n")
    .filter((s) => s.length > 0)
    .filter(predicate);
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bh-recorder-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("NetworkRecorder happy path", () => {
  it("writes warcinfo + request/response pair for a single GET", async () => {
    const path = join(tmpDir, "happy.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.setBody("req-1", "<html>hello</html>");

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: {
        url: "https://example.com/",
        method: "GET",
        headers: { "User-Agent": "test", Accept: "*/*" },
      },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://example.com/",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/html",
        headers: { "Content-Type": "text/html" },
        encodedDataLength: 18,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 18,
    });

    // Allow microtasks queued by the event handlers to drain.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const result = await recorder.stop();
    expect(result.stats.totalRecorded).toBe(1);
    expect(result.stats.totalBodyBytes).toBeGreaterThan(0);

    const warc = dumpWarc(path);
    expect(warc).toContain("WARC-Type: warcinfo");
    expect(warc).toContain("software: browserhive-test/0.0.0");
    expect(warc).toContain("WARC-Type: request");
    expect(warc).toContain("WARC-Type: response");
    expect(warc).toContain("GET / HTTP/1.1");
    expect(warc).toContain("HTTP/1.1 200 OK");
    expect(warc).toContain("<html>hello</html>");
  });

  it("merges requestWillBeSentExtraInfo headers (Cookie / Authorization completeness)", async () => {
    const path = join(tmpDir, "extra-info.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.setBody("req-1", "ok");

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: {
        url: "https://example.com/secure",
        method: "GET",
        // Filtered: no Cookie, no Authorization (CDP omits these from the basic event)
        headers: { "User-Agent": "test" },
      },
    });
    session.emit("Network.requestWillBeSentExtraInfo", {
      requestId: "req-1",
      headers: {
        "User-Agent": "test",
        Cookie: "session=abc123; theme=dark",
        Authorization: "Bearer xyz",
      },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://example.com/secure",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/plain",
        headers: { "Content-Type": "text/plain" },
        encodedDataLength: 2,
      },
    });
    session.emit("Network.responseReceivedExtraInfo", {
      requestId: "req-1",
      headers: {
        "Content-Type": "text/plain",
        "Set-Cookie": "id=1; Path=/\nrefresh=2; Path=/",
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 2,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    await recorder.stop();
    const warc = dumpWarc(path);
    // Request record carries Cookie + Authorization (full headers preferred)
    expect(warc).toContain("Cookie: session=abc123; theme=dark");
    expect(warc).toContain("Authorization: Bearer xyz");
    // Set-Cookie split into two lines (CDP joins with \n)
    const setCookieMatches = warc.match(/Set-Cookie: /g) ?? [];
    expect(setCookieMatches.length).toBe(2);
  });
});

describe("NetworkRecorder filters", () => {
  it("drops requests matching block-list patterns and bumps totalBlocked", async () => {
    const path = join(tmpDir, "blocked.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(
      baseOpts(path, {
        filters: {
          blockUrlPatterns: ["*google-analytics.com/*"],
          skipContentTypes: [],
        },
      }),
      session,
    );

    session.emit("Network.requestWillBeSent", {
      requestId: "ga-1",
      request: {
        url: "https://www.google-analytics.com/collect?a=1",
        method: "GET",
        headers: {},
      },
    });
    // Even if a response would arrive it should be ignored.
    session.emit("Network.responseReceived", {
      requestId: "ga-1",
      response: {
        url: "https://www.google-analytics.com/collect?a=1",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        headers: {},
        encodedDataLength: 0,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "ga-1",
      encodedDataLength: 0,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    expect(result.stats.totalBlocked).toBe(1);
    expect(result.stats.totalRecorded).toBe(0);

    const warc = dumpWarc(path);
    expect(warc).not.toContain("google-analytics.com");
  });

  it("emits metadata record when content-type matches skipContentTypes prefix", async () => {
    const path = join(tmpDir, "skip-mime.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(
      baseOpts(path, {
        filters: { blockUrlPatterns: [], skipContentTypes: ["video/"] },
      }),
      session,
    );

    session.setBody("req-1", "fake-mp4-body");

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://cdn.example.com/v.mp4", method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://cdn.example.com/v.mp4",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "video/mp4",
        headers: { "Content-Type": "video/mp4" },
        encodedDataLength: 13,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 13,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    expect(result.stats.totalSkippedContentType).toBe(1);

    const warc = dumpWarc(path);
    expect(warc).toContain("WARC-Type: metadata");
    expect(warc).toContain("truncated: content-type");
    // Body bytes must NOT appear in the response record
    expect(warc).not.toContain("fake-mp4-body");
  });

  it("emits metadata when single response exceeds maxResponseBytes (declared via encodedDataLength)", async () => {
    const path = join(tmpDir, "too-large.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(
      baseOpts(path, {
        limits: {
          maxResponseBytes: 100,
          maxTaskBytes: 10_000,
          maxPendingRequests: 100,
        },
      }),
      session,
    );

    session.emit("Network.requestWillBeSent", {
      requestId: "big-1",
      request: { url: "https://example.com/big", method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId: "big-1",
      response: {
        url: "https://example.com/big",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "application/octet-stream",
        // As an origin actually answers. With `{}` here, a failure to strip
        // these on the drop path leaves nothing behind to notice.
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "1000",
          "content-encoding": "gzip",
        },
        // Deliberately NOT 1000: `responseReceived` reports what had arrived by
        // then (the headers), `loadingFinished` reports the whole transfer.
        // Feeding one constant to both is what let the recorder read the wrong
        // one for years without a unit test noticing.
        encodedDataLength: 156,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "big-1",
      encodedDataLength: 1000,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    expect(result.stats.totalTruncatedTooLarge).toBe(1);

    const warc = dumpWarc(path);
    expect(warc).toContain("truncated: too-large");

    const response = findRecord(warc, (r) => r.includes("WARC-Type: response"));
    expect(response).toBeDefined();

    // The archived HTTP message has to describe what was stored. Claiming 1000
    // bytes of gzip over an empty body is not a valid message, and a strict
    // reader (warcio, pywb, waxlens) either blocks on it or reads into the next
    // record.
    expect(response).not.toMatch(/content-length: 1000/i);
    expect(response).toMatch(/content-length: 0/i);
    expect(response).not.toMatch(/content-encoding/i);

    // WARC 1.1 provides the field for exactly this, and without it a reader
    // cannot tell "the origin sent nothing" from "we dropped it".
    expect(response).toContain("WARC-Truncated: length");

    // The size of what was dropped — 1000, the whole transfer. 156 would be
    // the headers alone, which explains nothing about the body that went
    // missing.
    expect(warc).toContain("encodedDataLength: 1000");

    // The reason travels with the recorded response, not just into the WARC:
    // `analyzeCompleteness` reads these to decide whether the archive holds
    // everything a replay will ask for, and `payloadDigest === undefined`
    // cannot distinguish a dropped body from a redirect.
    expect(result.responses.map((r) => r.bodySkipReason)).toEqual(["too-large"]);
  });

  it("transitions to task-cap after cumulative bytes exceed maxTaskBytes", async () => {
    const path = join(tmpDir, "task-cap.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(
      baseOpts(path, {
        limits: {
          maxResponseBytes: 1_000_000,
          maxTaskBytes: 10, // very small to force the cap quickly
          maxPendingRequests: 100,
        },
      }),
      session,
    );

    // First request: 8 bytes — fits under cap.
    session.setBody("req-1", "12345678");
    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/a", method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://example.com/a",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/plain",
        headers: {},
        encodedDataLength: 8,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 8,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Second request: 8 more bytes — would push us over 10. Should be truncated.
    session.setBody("req-2", "12345678");
    session.emit("Network.requestWillBeSent", {
      requestId: "req-2",
      request: { url: "https://example.com/b", method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-2",
      response: {
        url: "https://example.com/b",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/plain",
        headers: {},
        encodedDataLength: 8,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-2",
      encodedDataLength: 8,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const result = await recorder.stop();
    expect(result.stats.totalRecorded).toBe(1);
    expect(result.stats.totalTruncatedTaskCap).toBe(1);

    const warc = dumpWarc(path);
    expect(warc).toContain("truncated: task-cap");
  });
});

describe("NetworkRecorder failure paths", () => {
  it("emits a metadata record when loadingFailed fires", async () => {
    const path = join(tmpDir, "failed.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://gone.example.com/", method: "GET", headers: {} },
    });
    session.emit("Network.loadingFailed", {
      requestId: "req-1",
      errorText: "net::ERR_NAME_NOT_RESOLVED",
      canceled: false,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    expect(result.stats.totalFailed).toBe(1);

    const warc = dumpWarc(path);
    expect(warc).toContain("WARC-Type: metadata");
    expect(warc).toContain("reason: loadingFailed");
    expect(warc).toContain("errorText: net::ERR_NAME_NOT_RESOLVED");
  });

  it("enriches the loadingFailed metadata with resourceType / blockedReason / status", async () => {
    const path = join(tmpDir, "failed-rich.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      type: "Image",
      request: { url: "https://ads.example.com/x.png", method: "GET", headers: {} },
    });
    // A response arrived before the load failed → status should be captured.
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://ads.example.com/x.png",
        status: 206,
        statusText: "Partial Content",
        protocol: "http/1.1",
        mimeType: "image/png",
        headers: {},
        encodedDataLength: 0,
      },
    });
    session.emit("Network.loadingFailed", {
      requestId: "req-1",
      type: "Image",
      blockedReason: "inspector",
      errorText: "net::ERR_BLOCKED_BY_CLIENT",
      canceled: false,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await recorder.stop();

    const warc = dumpWarc(path);
    expect(warc).toContain("resourceType: Image");
    expect(warc).toContain("blockedReason: inspector");
    expect(warc).toContain("status: 206");
  });

  it("enriches the stop-while-pending metadata with resourceType", async () => {
    const path = join(tmpDir, "incomplete-rich.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      type: "Script",
      request: { url: "https://slow.example.com/a.js", method: "GET", headers: {} },
    });
    // No response / loadingFinished — drained as stop-while-pending at stop().

    await new Promise<void>((resolve) => setImmediate(resolve));
    await recorder.stop();

    const warc = dumpWarc(path);
    expect(warc).toContain("reason: stop-while-pending");
    expect(warc).toContain("resourceType: Script");
  });

  it("records in-flight requests at stop() as incomplete metadata", async () => {
    const path = join(tmpDir, "incomplete.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://slow.example.com/", method: "GET", headers: {} },
    });
    // No responseReceived, no loadingFinished — recorder must still emit metadata.

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    expect(result.stats.totalIncomplete).toBe(1);

    const warc = dumpWarc(path);
    expect(warc).toContain("reason: stop-while-pending");
  });

  it("falls back to a body-less response when getResponseBody throws", async () => {
    const path = join(tmpDir, "no-body.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    session.setBodyError("req-1", new Error("No resource with given identifier"));

    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/x", method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://example.com/x",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/plain",
        headers: {},
        encodedDataLength: 5,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 5,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    // Still counts as recorded — request/response meta is preserved.
    expect(result.stats.totalRecorded).toBe(1);
    expect(result.stats.totalBodyBytes).toBe(0);

    const warc = dumpWarc(path);
    expect(warc).toContain("WARC-Type: response");
    expect(warc).toContain("HTTP/1.1 200 OK");
  });
});

describe("NetworkRecorder redirects", () => {
  it("finalizes the previous step when requestWillBeSent reuses the requestId with redirectResponse", async () => {
    const path = join(tmpDir, "redirect.warc.gz");
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(path), session);

    // First request /a
    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/a", method: "GET", headers: {} },
    });
    // Redirect: same requestId, redirectResponse carries the 301 we should record.
    session.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/b", method: "GET", headers: {} },
      redirectResponse: {
        url: "https://example.com/a",
        status: 301,
        statusText: "Moved Permanently",
        protocol: "http/1.1",
        mimeType: "text/html",
        headers: { Location: "https://example.com/b" },
        encodedDataLength: 0,
      },
    });
    // Final response on the redirected URL
    session.setBody("req-1", "<html>final</html>");
    session.emit("Network.responseReceived", {
      requestId: "req-1",
      response: {
        url: "https://example.com/b",
        status: 200,
        statusText: "OK",
        protocol: "http/1.1",
        mimeType: "text/html",
        headers: { "Content-Type": "text/html" },
        encodedDataLength: 18,
      },
    });
    session.emit("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 18,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await recorder.stop();
    // Two recorded pairs: redirect (301) + final (200)
    expect(result.stats.totalRecorded).toBe(2);

    const warc = dumpWarc(path);
    const responseRecords = findAllRecords(warc, (r) =>
      r.includes("WARC-Type: response"),
    );
    expect(responseRecords).toHaveLength(2);
    const targetUris = responseRecords
      .map((r) => /WARC-Target-URI: (\S+)/.exec(r)?.[1])
      .filter((s): s is string => s !== undefined);
    expect(targetUris).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    // Final response (200 to /b) carries the body. The redirect response
    // (/a → /b 301) ALSO contains the literal "https://example.com/b" via
    // its `Location:` header, so we anchor on `WARC-Target-URI: …/b` to
    // pick the right record.
    expect(findRecord(warc, (r) =>
      r.includes("WARC-Target-URI: https://example.com/b") &&
      r.includes("WARC-Type: response"),
    )).toContain("<html>final</html>");
  });
});

/**
 * What the browser saw of each TLS connection.
 *
 * `securityDetails` rides on `responseReceived`, an event the recorder already
 * handles — so this costs no extra CDP round-trip and the only question is
 * what to keep. Per host, not per response: a hundred requests to one origin
 * are one connection's worth of information, and writing it a hundred times
 * would say nothing more.
 *
 * A certificate proves nothing about who we talked to — it is public, and
 * anyone can present a copy. It is kept for two narrower things: the issuer
 * shows whether the connection was intercepted, and the validity window can be
 * checked against a claimed capture time.
 */
describe("NetworkRecorder — observed TLS", () => {
  const securityDetails = (subject: string) => ({
    protocol: "TLS 1.3",
    cipher: "AES_128_GCM",
    subjectName: subject,
    issuer: "Example CA G4",
    // CDP reports these as epoch seconds.
    validFrom: 1_762_340_773,
    validTo: 1_796_396_340,
    sanList: [subject],
  });

  const respond = (
    session: FakeSession,
    requestId: string,
    url: string,
    security?: ReturnType<typeof securityDetails>,
  ): void => {
    session.emit("Network.requestWillBeSent", {
      requestId,
      request: { url, method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId,
      response: {
        url,
        status: 200,
        statusText: "OK",
        protocol: "h2",
        mimeType: "text/html",
        headers: {},
        encodedDataLength: 4,
        ...(security !== undefined && { securityDetails: security }),
      },
    });
    session.setBody(requestId, "body");
    session.emit("Network.loadingFinished", { requestId, encodedDataLength: 4 });
  };

  it("keeps one entry per host, not one per response", async () => {
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(join(tmpDir, "tls.warc.gz")), session);

    respond(session, "r1", "https://a.example/one", securityDetails("a.example"));
    respond(session, "r2", "https://a.example/two", securityDetails("a.example"));

    const { tls } = await recorder.stop();

    expect(Object.keys(tls)).toEqual(["a.example"]);
    expect(tls["a.example"]).toMatchObject({
      protocol: "TLS 1.3",
      cipher: "AES_128_GCM",
      subject: "a.example",
      issuer: "Example CA G4",
    });
  });

  it("converts CDP's epoch seconds into the timestamps everything else uses", async () => {
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(join(tmpDir, "tls.warc.gz")), session);

    respond(session, "r1", "https://a.example/x", securityDetails("a.example"));

    const { tls } = await recorder.stop();

    // Every other date in the archive is ISO 8601. A raw epoch here would make
    // the one field a reader most wants to compare against a capture time the
    // one field they have to convert first.
    expect(tls["a.example"]).toMatchObject({
      validFrom: "2025-11-05T11:06:13.000Z",
      validTo: "2026-12-04T14:59:00.000Z",
    });
  });

  it("ignores hosts that were never HTTPS", async () => {
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(join(tmpDir, "tls.warc.gz")), session);

    respond(session, "r1", "http://plain.example/x");

    const { tls } = await recorder.stop();

    // Absent, not null: `null` is reserved for "HTTPS, and we got nothing",
    // which is a different thing a reader has to be able to tell apart.
    expect(tls).not.toHaveProperty("plain.example");
  });

  it("records null for an HTTPS host that reported no details", async () => {
    const session = makeFakeSession();
    const recorder = await startRecorder(baseOpts(join(tmpDir, "tls.warc.gz")), session);

    respond(session, "r1", "https://quiet.example/x");

    const { tls } = await recorder.stop();

    expect(tls).toHaveProperty("quiet.example", null);
  });
});

/**
 * The certificate chains themselves.
 *
 * Fetched at stop rather than per response: the page is still open here, and
 * asking during the capture would put a CDP round-trip on the critical path of
 * every request for information that does not change between them.
 *
 * Stored because an exhibit should not depend on a third-party service still
 * being reachable years later. Certificate Transparency holds the same bytes,
 * but a chain from a private CA — which is exactly the interception case worth
 * examining — was never logged there at all.
 */
describe("NetworkRecorder — certificate chains", () => {
  const chainFor = (host: string): string[] => [`leaf-${host}`, "intermediate", "root"];

  const withCertificates = (
    session: FakeSession,
    chains: Record<string, string[]>,
  ): string[] => {
    const asked: string[] = [];
    const inner = session.send.bind(session);
    session.send = async (method: string, params?: Record<string, unknown>) => {
      if (method === "Network.getCertificate") {
        const raw = params?.["origin"];
        const origin = typeof raw === "string" ? raw : "";
        asked.push(origin);
        const chain = chains[origin];
        if (chain === undefined) throw new Error(`no certificate for ${origin}`);
        // Misleadingly named by CDP: the payload is base64 DER, not table names.
        return { tableNames: chain };
      }
      return inner(method, params);
    };
    return asked;
  };

  const securityDetails = (subject: string) => ({
    protocol: "TLS 1.3",
    cipher: "AES_128_GCM",
    subjectName: subject,
    issuer: "Example CA G4",
    validFrom: 1_762_340_773,
    validTo: 1_796_396_340,
    sanList: [subject],
  });

  const respond = (session: FakeSession, requestId: string, url: string): void => {
    const host = new URL(url).host;
    session.emit("Network.requestWillBeSent", {
      requestId,
      request: { url, method: "GET", headers: {} },
    });
    session.emit("Network.responseReceived", {
      requestId,
      response: {
        url,
        status: 200,
        statusText: "OK",
        protocol: "h2",
        mimeType: "text/html",
        headers: {},
        encodedDataLength: 4,
        securityDetails: securityDetails(host),
      },
    });
    session.setBody(requestId, "body");
    session.emit("Network.loadingFinished", { requestId, encodedDataLength: 4 });
  };

  it("asks each origin once, however many responses it served", async () => {
    const session = makeFakeSession();
    const asked = withCertificates(session, {
      "https://a.example": chainFor("a"),
    });
    const recorder = await startRecorder(baseOpts(join(tmpDir, "c.warc.gz")), session);

    respond(session, "r1", "https://a.example/one");
    respond(session, "r2", "https://a.example/two");
    await recorder.stop();

    expect(asked).toEqual(["https://a.example"]);
  });

  it("stores a shared chain once and points both hosts at it", async () => {
    const session = makeFakeSession();
    const shared = ["leaf-shared", "intermediate", "root"];
    withCertificates(session, {
      "https://a.example": shared,
      "https://b.example": shared,
    });
    const recorder = await startRecorder(baseOpts(join(tmpDir, "c.warc.gz")), session);

    respond(session, "r1", "https://a.example/x");
    respond(session, "r2", "https://b.example/x");
    const { tls, tlsChains } = await recorder.stop();

    // Measured on a real capture: 15 hosts, 3 distinct chains, 53.3 KB raw
    // against 12.8 KB deduplicated. Storing per host would be mostly copies.
    expect(Object.keys(tlsChains)).toHaveLength(1);
    expect(tls["a.example"]?.chainRef).toBe(tls["b.example"]?.chainRef);
    expect(tlsChains[tls["a.example"]!.chainRef!]).toEqual(shared);
  });

  it("leaves a host without a chainRef when the fetch failed", async () => {
    const session = makeFakeSession();
    withCertificates(session, {});   // every origin throws
    const recorder = await startRecorder(baseOpts(join(tmpDir, "c.warc.gz")), session);

    respond(session, "r1", "https://a.example/x");
    const { tls, tlsChains } = await recorder.stop();

    // The observation survives even when the chain does not — `issuer` is the
    // field that catches interception, and it came from a different source.
    expect(tls["a.example"]).toMatchObject({ issuer: "Example CA G4" });
    expect(tls["a.example"]?.chainRef).toBeUndefined();
    expect(tlsChains).toEqual({});
  });

  it("still produces the archive when certificates cannot be fetched at all", async () => {
    const session = makeFakeSession();
    withCertificates(session, {});
    const recorder = await startRecorder(baseOpts(join(tmpDir, "c.warc.gz")), session);

    respond(session, "r1", "https://a.example/x");

    // A certificate is not what a capture is for. Unlike a required signature,
    // its absence costs a field, not the archive.
    await expect(recorder.stop()).resolves.toBeDefined();
  });
});
