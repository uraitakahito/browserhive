/**
 * NetworkRecorder
 *
 * Subscribes to CDP `Network.*` events on a per-task basis and writes one
 * `.warc.gz` to a temp file. The lifecycle (`start` / `stop`) is owned by
 * `PageCapturer.capture` so the recorder is attached BEFORE `page.goto`
 * (which is itself recorded as the first request) and detached AFTER all
 * format-specific reads complete but BEFORE `resetPageState` runs (we
 * don't want `about:blank` polluting the archive).
 *
 * Concurrency model
 * -----------------
 * CDP events arrive synchronously to the EventEmitter. Multiple events for
 * a single `requestId` (`requestWillBeSent` with redirect → next
 * `responseReceived` → `loadingFinished`) can fire in tight succession
 * before any await yields. The recorder therefore enforces two rules:
 *
 *   1. **Map updates are synchronous.** Every change to `pending` happens
 *      inside an event handler before any `await`, so a redirect's
 *      `requestWillBeSent` swaps the slot for the next step before the
 *      sibling `responseReceived` handler can read the wrong entry.
 *   2. **WARC writes are serialized via `writeQueue`.** Build-record logic
 *      stays sync; the actual `writer.writeRecord` calls are chained on a
 *      single `Promise<void>` so concatenated gzip members never interleave
 *      (which would produce an unreadable file).
 *
 * Header completeness contract
 * ----------------------------
 * `Network.requestWillBeSent` and `Network.responseReceived` carry a
 * **filtered** view of headers — Chromium strips `Cookie` / `Set-Cookie` /
 * `Authorization` from the basic event for IPC security. The full,
 * unredacted headers are delivered separately via
 * `Network.requestWillBeSentExtraInfo` and `Network.responseReceivedExtraInfo`.
 * The recorder always prefers the ExtraInfo headers when present
 * (regardless of arrival order), so the WARC always carries full Cookie /
 * Authorization / Set-Cookie data — the contract Phase 6 depends on for
 * faithful replay.
 *
 * Memory / size discipline
 * ------------------------
 * Bodies are fetched eagerly via `Network.getResponseBody` after
 * `loadingFinished`, decoded if base64, then written. Three independent
 * caps protect the worker from OOM:
 *
 *   1. `maxResponseBytes` — per-response cap. Triggered by either the
 *      pre-fetch `encodedDataLength` (if available) or the post-fetch
 *      buffer length. Body becomes a `metadata` record.
 *   2. `maxTaskBytes` — cumulative cap. Once cleared, all subsequent
 *      responses are recorded as `metadata` truncations.
 *   3. `maxPendingRequests` — bound on the in-flight tracking map. Old
 *      entries are evicted by insertion order when exceeded.
 *
 * Failure / shutdown
 * ------------------
 * `stop()` drains in-flight entries as `metadata { incomplete: true }`
 * records, detaches the CDP session (best-effort), and finalizes the WARC.
 * Any I/O error inside the write queue is logged and swallowed — a single
 * malformed network event must not fail the parent capture.
 */
import { Buffer } from "node:buffer";
import type { CDPSession, Page, Protocol } from "puppeteer";
import {
  buildHttpRequestBytes,
  buildHttpResponseBytes,
  buildMetadataRecord,
  buildRequestRecord,
  buildResponseRecord,
  buildWarcInfoRecord,
  cdpHeadersToList,
  newRecordId,
  WarcWriter,
  type HttpHeader,
  type WarcRecord,
  type WarcRecordWriteInfo,
} from "../storage/warc/index.js";
import { createHash } from "node:crypto";
import { logger as rootLogger } from "../logger.js";
import {
  createEmptyRecordingStats,
  pushSample,
  type NetworkRecorderOptions,
  type CertificateChains,
  type ObservedTlsByHost,
  type RecordedResponse,
  type RecordingStats,
} from "./network-recorder-types.js";

// CDP types from puppeteer's Protocol namespace, narrowed to what we read.
type RequestWillBeSentEvent = Protocol.Network.RequestWillBeSentEvent;
type RequestWillBeSentExtraInfoEvent =
  Protocol.Network.RequestWillBeSentExtraInfoEvent;
type ResponseReceivedEvent = Protocol.Network.ResponseReceivedEvent;
type ResponseReceivedExtraInfoEvent =
  Protocol.Network.ResponseReceivedExtraInfoEvent;
type LoadingFinishedEvent = Protocol.Network.LoadingFinishedEvent;
type LoadingFailedEvent = Protocol.Network.LoadingFailedEvent;

interface PendingRequest {
  /** Pre-allocated WARC record IDs so request/response can link via `WARC-Concurrent-To` before the response arrives. */
  requestRecordId: string;
  responseRecordId: string;
  /** Filled in from `requestWillBeSent`. */
  url: string;
  method: string;
  postData?: Buffer;
  basicRequestHeaders: Record<string, string>;
  /** Filled in from `requestWillBeSentExtraInfo` if it ever arrives. Preferred over `basicRequestHeaders`. */
  fullRequestHeaders?: Record<string, string>;
  /** Filled in from `responseReceived`. */
  response?: ResponseSnapshot;
  /** Filled in from `responseReceivedExtraInfo` if it ever arrives. Preferred over `response.headers`. */
  fullResponseHeaders?: Record<string, string>;
  /** True if a default block-pattern matched at request time. Subsequent events for the same id are ignored. */
  blocked: boolean;
  /** Body should not be fetched / written even when present. */
  skipBody: boolean;
  /** Set when `skipBody` is true; emitted into the metadata record body. */
  skipBodyReason?: "content-type" | "too-large" | "task-cap";
  /**
   * Bytes on the wire for the whole response, from `loadingFinished`.
   *
   * Kept because the size of a body we dropped is the one thing the metadata
   * record exists to report, and it is not available where that record is
   * built: the response snapshot's own `encodedDataLength` comes from
   * `responseReceived`, which fires before the body arrives and counts only
   * the headers.
   */
  transferSize?: number;
  /** Wall-clock ms when the entry was first created. Used for FIFO eviction when over `maxPendingRequests`. */
  enqueuedAt: number;
  /** ResourceType (Image / Script / XHR / Fetch …) from `requestWillBeSent.type`. Emitted into metadata records. */
  resourceType?: string;
}

interface ResponseSnapshot {
  url: string;
  status: number;
  statusText: string;
  httpVersion: string;
  mimeType?: string;
  /** Filtered headers (no Cookie / no Set-Cookie). Replaced by `fullResponseHeaders` when ExtraInfo arrives. */
  headers: Record<string, string>;
  remoteIPAddress?: string;
  encodedDataLength?: number;
}

/**
 * Convert a glob (only `*` recognised) to a regex matching the full URL.
 * Use `^...$` anchors so partial matches don't fire — callers usually want
 * `*.host/*` to match the host literally with optional subdomain.
 */
const globToRegex = (glob: string): RegExp => {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`);
};

const protocolToHttpVersion = (protocol: string | undefined): string => {
  if (protocol === undefined) return "HTTP/1.1";
  const p = protocol.toLowerCase();
  if (p === "h2" || p === "http/2" || p === "http/2.0") return "HTTP/2.0";
  if (p === "http/1.0") return "HTTP/1.0";
  return "HTTP/1.1";
};

/**
 * Standard HTTP reason-phrase fallback for status codes whose textual form
 * is missing in CDP (HTTP/2 transports always set `statusText: ""`). The
 * WARC `application/http;msgtype=response` payload is required by wabac.js
 * (and `pywb`, `warcio`) to be a parseable HTTP/1.1 status line — empty
 * reason phrases or non-1.1 versions cause "Archived Page Not Found"
 * because wabac.js's HTTP parser silently rejects the record.
 */
const STATUS_TEXT_FALLBACK: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  410: "Gone",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const fallbackStatusText = (status: number, original: string): string => {
  if (original.length > 0) return original;
  return STATUS_TEXT_FALLBACK[status] ?? "OK";
};

/**
 * HTTP/2 introduced pseudo-headers (`:authority`, `:method`, `:path`,
 * `:scheme`, `:status`) that have no analog in HTTP/1.1 wire format. CDP
 * surfaces them in the headers map verbatim. WARC payloads must be
 * HTTP/1.1-shaped — these names start with `:` which is illegal as a
 * header name in HTTP/1.1, so wabac.js's parser fails the whole record
 * when it sees them. Strip every `:`-prefixed entry.
 */
const isPseudoHeader = (name: string): boolean => name.startsWith(":");

/**
 * Stand-in payload for a response record that stored no body.
 *
 * A redirect hop, a `304`, a body dropped by a size cap — all of them archive
 * zero bytes, and zero bytes hash to a well-defined value. Digesting it keeps
 * `WARC-Payload-Digest` present, which in turn keeps the CDXJ line's `digest`
 * present, which CDXJ 0.1.0 requires on every entry.
 */
const EMPTY_PAYLOAD = Buffer.alloc(0);

/**
 * Build the HTTP/1.1-normalised request headers for the WARC payload.
 *
 * Two transformations:
 *  1. Drop HTTP/2 pseudo-headers.
 *  2. If `Host` is missing, derive it from the request URL — HTTP/2's
 *     `:authority` is the source-of-truth for this in the wire protocol,
 *     but we already stripped it in step 1.
 */
const buildHttp11RequestHeaders = (
  cdpHeaders: Record<string, string>,
  url: string,
): Record<string, string> => {
  const out: Record<string, string> = {};
  let hasHost = false;
  for (const [name, value] of Object.entries(cdpHeaders)) {
    if (isPseudoHeader(name)) continue;
    out[name] = value;
    if (name.toLowerCase() === "host") hasHost = true;
  }
  if (!hasHost) {
    try {
      out["Host"] = new URL(url).host;
    } catch {
      // Opaque URL (data:, blob:, …) — no Host needed.
    }
  }
  return out;
};

/**
 * Build the HTTP/1.1-normalised response headers for the WARC payload.
 *
 * Three transformations:
 *  1. Drop HTTP/2 pseudo-headers.
 *  2. When the body has been decoded by CDP (the common case —
 *     `Network.getResponseBody` returns plaintext regardless of wire
 *     `content-encoding`), strip the encoding declaration. Leaving
 *     `content-encoding: br` next to a plaintext body causes wabac.js to
 *     re-Brotli-decode and crash, returning "Archived Page Not Found".
 *  3. Strip `transfer-encoding` (chunked is a wire concern that doesn't
 *     survive the decoded body) and the original `content-length` (the
 *     caller appends a corrected one).
 */
const buildHttp11ResponseHeaders = (
  cdpHeaders: Record<string, string>,
  /**
   * Whether the caller is about to state the stored body's length itself.
   *
   * True both when a body was decoded and when one was deliberately dropped —
   * in the second case the honest length is zero, and leaving the origin's
   * `content-length` in place would describe a body that is not there. False
   * only for responses that never had a body (redirect, 304, 204), whose
   * headers are already consistent and are left untouched.
   */
  rewriteLength: boolean,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(cdpHeaders)) {
    if (isPseudoHeader(name)) continue;
    if (rewriteLength) {
      const lower = name.toLowerCase();
      if (
        lower === "content-encoding" ||
        lower === "transfer-encoding" ||
        lower === "content-length"
      ) {
        continue;
      }
    }
    out[name] = value;
  }
  return out;
};

/**
 * Build the request-target part of the HTTP request line (path + query).
 * Origin-form per RFC 7230 §5.3.1.
 */
const extractRequestTarget = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

const matchesAny = (subject: string, patterns: RegExp[]): boolean =>
  patterns.some((p) => p.test(subject));

const matchesPrefixAny = (subject: string, prefixes: string[]): boolean =>
  prefixes.some((p) => subject.startsWith(p));

/**
 * CDP の `Network` ドメインを購読し、リクエスト/レスポンスを WARC として
 * 1 本のキューで直列に書き出す記録器。ブロックや種別ごとの内訳
 * (`byResourceType` / `byBlockedReason`)も集計する。
 *
 * @glossary NetworkRecorder
 * @category コンポーネント
 */
export class NetworkRecorder {
  private readonly opts: NetworkRecorderOptions;
  private readonly blockPatterns: RegExp[];
  private readonly stats: RecordingStats = createEmptyRecordingStats();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly logger = rootLogger.child({ component: "NetworkRecorder" });

  private session: CDPSession | null = null;
  private writer: WarcWriter | null = null;
  /** Single-threaded write queue — see class docstring "Concurrency model". */
  private writeQueue: Promise<void> = Promise.resolve();
  /** Accumulated `response`-record metadata for the WACZ CDXJ index. */
  private recordedResponses: RecordedResponse[] = [];
  private started = false;
  private stopped = false;
  /**
   * One entry per host, filled as responses arrive.
   *
   * Keyed by host rather than origin because the port is not what a reader is
   * checking — "who issued the certificate this name presented" is, and a host
   * reached on two ports presents the same one.
   */
  private readonly tls: ObservedTlsByHost = {};
  /** Chains keyed by their own hash. Filled at stop, not while recording. */
  private readonly tlsChains: CertificateChains = {};

  constructor(options: NetworkRecorderOptions) {
    this.opts = options;
    this.blockPatterns = options.filters.blockUrlPatterns.map(globToRegex);
  }

  /**
   * Inject a CDP session directly (test-only). Skips `page.createCDPSession`
   * and `Network.enable`, which is what `start()` would otherwise do.
   */
  static async startWithSession(
    options: NetworkRecorderOptions,
    session: CDPSession,
  ): Promise<NetworkRecorder> {
    const recorder = new NetworkRecorder(options);
    await recorder.attachSession(session, /* enableNetwork */ false);
    return recorder;
  }

  async start(page: Page): Promise<void> {
    if (this.started) throw new Error("NetworkRecorder already started");
    const session = await page.createCDPSession();
    await this.attachSession(session, /* enableNetwork */ true);
  }

  private async attachSession(
    session: CDPSession,
    enableNetwork: boolean,
  ): Promise<void> {
    this.session = session;
    this.writer = new WarcWriter(this.opts.warcPath);
    this.started = true;

    // Write warcinfo first — readers expect it as the leading record.
    const warcInfoFields: Record<string, string> = {
      software: this.opts.software,
      format: "WARC File Format 1.1",
      conformsTo:
        "http://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/",
      "robots-policy": "ignore",
    };
    if (this.opts.description !== undefined) {
      warcInfoFields["description"] = this.opts.description;
    }
    this.enqueueRecord(
      buildWarcInfoRecord({
        filename: this.opts.warcFilename,
        fields: warcInfoFields,
      }),
    );

    // Bind handlers as arrow methods so `this` binds correctly without `.bind(this)`.
    session.on("Network.requestWillBeSent", this.onRequestWillBeSent);
    session.on(
      "Network.requestWillBeSentExtraInfo",
      this.onRequestWillBeSentExtraInfo,
    );
    session.on("Network.responseReceived", this.onResponseReceived);
    session.on(
      "Network.responseReceivedExtraInfo",
      this.onResponseReceivedExtraInfo,
    );
    session.on("Network.loadingFinished", this.onLoadingFinished);
    session.on("Network.loadingFailed", this.onLoadingFailed);

    if (enableNetwork) {
      await session.send("Network.enable", {
        // 50 MB per resource, 500 MB total — generous so we never miss a body
        // due to CDP buffer eviction. The per-task cap (maxTaskBytes) is the
        // real ceiling enforced at write time.
        maxResourceBufferSize: 50 * 1024 * 1024,
        maxTotalBufferSize: 500 * 1024 * 1024,
      });
    }
  }

  /**
   * Drain in-flight requests as incomplete metadata, detach CDP, finalize
   * the WARC. Always returns the WARC path + stats; partial failures inside
   * the drain are logged but do not propagate (the WARC produced so far is
   * still valuable).
   */
  /**
   * Record what this response revealed about its TLS connection.
   *
   * First writer wins: a host that answered once with details and later
   * without keeps them. The alternative — last writer — would let a single
   * detail-less response erase what was observed, and nothing is gained by
   * preferring the newer of two views of the same connection.
   */
  private noteTls(response: Protocol.Network.Response): void {
    let host: string;
    try {
      const url = new URL(response.url);
      if (url.protocol !== "https:") return;
      host = url.host;
    } catch {
      return;
    }
    if (this.tls[host] !== undefined && this.tls[host] !== null) return;

    const d = response.securityDetails;
    if (d === undefined) {
      // Reached over HTTPS and told us nothing. Recorded as `null` so the
      // archive can say that, rather than looking like a plain-HTTP host.
      this.tls[host] ??= null;
      return;
    }
    this.tls[host] = {
      protocol: d.protocol,
      cipher: d.cipher,
      subject: d.subjectName,
      issuer: d.issuer,
      // CDP hands these over as epoch seconds. Every other date in the archive
      // is ISO 8601, and the whole point of keeping the validity window is to
      // compare it against a capture time — converting at the boundary means
      // nobody has to do it at the point of comparison.
      validFrom: new Date(d.validFrom * 1000).toISOString(),
      validTo: new Date(d.validTo * 1000).toISOString(),
    };
  }

  /**
   * Fetch the chain each HTTPS host presented, once per host.
   *
   * At stop, deliberately. The page is still attached here, so the certificates
   * are still available, and asking during the capture would put a CDP
   * round-trip on the critical path of every request to learn something that
   * does not change between them. Measured at 23ms for 15 hosts.
   *
   * `Network.enable` is a prerequisite: without it this returns zero entries
   * and no error, which would look exactly like a host with no certificate.
   * `start()` enables it, so the condition holds — but it is the reason a
   * missing chain is never read as "this host has none".
   *
   * Failures cost a field, not the capture. Unlike a required signature, a
   * certificate is not what the archive is for, and the observation from
   * `securityDetails` — the part that catches interception — is already kept.
   */
  private async collectCertificateChains(session: CDPSession): Promise<void> {
    for (const [host, observed] of Object.entries(this.tls)) {
      if (observed === null) continue;
      const origin = `https://${host}`;
      try {
        const result = (await session.send("Network.getCertificate", { origin })) as {
          tableNames?: string[];
        };
        // `tableNames` is CDP's own misleading name for the field; the payload
        // is the base64 DER chain, leaf first.
        const chain = result.tableNames;
        if (chain === undefined || chain.length === 0) continue;
        const ref = createHash("sha256").update(chain.join("")).digest("hex").slice(0, 16);
        this.tlsChains[ref] = chain;
        observed.chainRef = ref;
      } catch (err) {
        this.logger.debug(
          { host, err: err instanceof Error ? err.message : String(err) },
          "certificate chain unavailable",
        );
      }
    }
  }

  async stop(): Promise<{
    path: string;
    bytesWritten: number;
    stats: RecordingStats;
    /** Per-response WARC record metadata, used by the WACZ packager to build CDXJ. */
    responses: RecordedResponse[];
    /** What the browser saw of each HTTPS host's TLS connection. */
    tls: ObservedTlsByHost;
    /** The chains those hosts presented, deduplicated by content. */
    tlsChains: CertificateChains;
  }> {
    if (this.stopped) throw new Error("NetworkRecorder already stopped");
    this.stopped = true;

    // 1. Drain pending entries as incomplete metadata (sync enqueue).
    for (const [requestId, p] of this.pending) {
      this.stats.totalIncomplete += 1;
      this.enqueueRecord(
        buildMetadataRecord({
          targetUri: p.url,
          fields: {
            incomplete: "true",
            reason: "stop-while-pending",
            requestId,
            method: p.method,
            ...(p.resourceType && { resourceType: p.resourceType }),
          },
        }),
      );
    }
    this.pending.clear();

    // 2. Wait for queued writes to flush so finalize sees a consistent stream.
    await this.writeQueue;

    // 3. Certificates, while the session is still attached. This is the last
    // moment they are reachable — detaching below ends it — and doing it here
    // rather than per response keeps a CDP round-trip off the critical path of
    // every request.
    if (this.session) {
      await this.collectCertificateChains(this.session);
    }

    // 4. Best-effort detach.
    if (this.session) {
      try {
        await this.session.detach();
      } catch (err) {
        this.logger.warn({ err }, "CDP session detach failed");
      }
      this.session = null;
    }

    // 5. Finalize WARC.
    if (!this.writer) {
      throw new Error("NetworkRecorder.stop called before start");
    }
    const result = await this.writer.finalize();
    this.writer = null;
    return {
      ...result,
      stats: this.stats,
      responses: this.recordedResponses,
      tls: this.tls,
      tlsChains: this.tlsChains,
    };
  }

  /** Snapshot of current stats (useful for incremental logging mid-task). */
  getStats(): RecordingStats {
    return { ...this.stats };
  }

  // ─── Write queue ─────────────────────────────────────────────────────

  /**
   * Append a record to the serialized write queue. The optional `onWritten`
   * callback runs with the post-write metadata (offset / length / digest)
   * and is the hook used by `recordPair` to populate the CDXJ index.
   * Errors are logged but not propagated so the recorder remains usable
   * after a single bad write.
   */
  private enqueueRecord(
    record: WarcRecord,
    onWritten?: (info: WarcRecordWriteInfo) => void,
  ): void {
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.writer === null) return;
      try {
        const info = await this.writer.writeRecord(record);
        onWritten?.(info);
      } catch (err) {
        this.logger.warn(
          { err, type: record.headers["WARC-Type"] },
          "WARC writeRecord failed",
        );
      }
    });
  }

  // ─── CDP event handlers ──────────────────────────────────────────────
  //
  // Every handler keeps map mutations synchronous (before any await), then
  // delegates async I/O (getResponseBody) and ordered WARC writes to the
  // helpers below.

  private onRequestWillBeSent = (event: RequestWillBeSentEvent): void => {
    const { requestId, request } = event;

    // Block-list applies to every URL the page tries to issue.
    if (matchesAny(request.url, this.blockPatterns)) {
      this.stats.totalBlocked += 1;
      pushSample(this.stats.samples.blocked, request.url);
      // Mark the slot so subsequent ExtraInfo / response / loadingFinished
      // for this requestId are dropped.
      this.pending.set(requestId, {
        requestRecordId: newRecordId(),
        responseRecordId: newRecordId(),
        url: request.url,
        method: request.method,
        basicRequestHeaders: request.headers,
        blocked: true,
        skipBody: true,
        enqueuedAt: Date.now(),
        ...(event.type && { resourceType: event.type }),
      });
      return;
    }

    // Redirect: same requestId carries forward. Synchronously finalize the
    // previous step (record builds are sync; writes go to the queue) and
    // swap the map slot before any sibling event can read it.
    if (event.redirectResponse !== undefined) {
      const prev = this.pending.get(requestId);
      if (prev !== undefined && !prev.blocked) {
        const r = event.redirectResponse;
        const redirectSnap: ResponseSnapshot = {
          url: r.url,
          status: r.status,
          statusText: r.statusText,
          httpVersion: protocolToHttpVersion(r.protocol),
          headers: r.headers,
        };
        // mimeType / encodedDataLength are non-optional in puppeteer's CDP
        // typings — a value is always present (possibly "" / 0). remoteIPAddress
        // is genuinely optional.
        redirectSnap.mimeType = r.mimeType;
        redirectSnap.encodedDataLength = r.encodedDataLength;
        if (r.remoteIPAddress !== undefined) {
          redirectSnap.remoteIPAddress = r.remoteIPAddress;
        }
        // Redirect records have no body — `getResponseBody` is unavailable
        // for the intermediate hop.
        this.recordPair(prev, redirectSnap, /* body */ undefined);
      }
    }

    // Evict oldest if the in-flight map is at capacity.
    if (this.pending.size >= this.opts.limits.maxPendingRequests) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) {
        this.pending.delete(oldest);
        this.logger.warn(
          { evicted: oldest, capacity: this.opts.limits.maxPendingRequests },
          "Evicted oldest pending request to bound memory",
        );
      }
    }

    const entry: PendingRequest = {
      requestRecordId: newRecordId(),
      responseRecordId: newRecordId(),
      url: request.url,
      method: request.method,
      basicRequestHeaders: request.headers,
      blocked: false,
      skipBody: false,
      enqueuedAt: Date.now(),
      ...(event.type && { resourceType: event.type }),
    };
    // CDP exposes the same body via `postData` (deprecated string form) and
    // `postDataEntries` (preferred, base64). We accept the deprecated path
    // because the preferred one requires an extra `Network.getRequestPostData`
    // round-trip per request just to stitch entries back together — overkill
    // for the request-side body, which most HTTP traffic doesn't even have.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const postData = request.postData;
    if (typeof postData === "string") {
      entry.postData = Buffer.from(postData, "utf-8");
    }
    this.pending.set(requestId, entry);
  };

  private onRequestWillBeSentExtraInfo = (
    event: RequestWillBeSentExtraInfoEvent,
  ): void => {
    const entry = this.pending.get(event.requestId);
    if (entry === undefined || entry.blocked) return;
    entry.fullRequestHeaders = event.headers;
  };

  private onResponseReceived = (event: ResponseReceivedEvent): void => {
    const entry = this.pending.get(event.requestId);
    if (entry === undefined || entry.blocked) return;
    const snap: ResponseSnapshot = {
      url: event.response.url,
      status: event.response.status,
      statusText: event.response.statusText,
      httpVersion: protocolToHttpVersion(event.response.protocol),
      headers: event.response.headers,
    };
    // mimeType / encodedDataLength are non-optional in puppeteer's CDP types.
    snap.mimeType = event.response.mimeType;
    snap.encodedDataLength = event.response.encodedDataLength;
    if (event.response.remoteIPAddress !== undefined) {
      snap.remoteIPAddress = event.response.remoteIPAddress;
    }
    this.noteTls(event.response);
    entry.response = snap;

    // Apply content-type filter at this point so we don't waste the
    // `getResponseBody` call. Empty mimeType (rare, but possible for
    // OPTIONS / HEAD-style responses) is treated as "no filter match".
    const mime = event.response.mimeType;
    if (
      mime !== "" &&
      matchesPrefixAny(mime, this.opts.filters.skipContentTypes)
    ) {
      entry.skipBody = true;
      entry.skipBodyReason = "content-type";
    }
  };

  private onResponseReceivedExtraInfo = (
    event: ResponseReceivedExtraInfoEvent,
  ): void => {
    const entry = this.pending.get(event.requestId);
    if (entry === undefined || entry.blocked) return;
    entry.fullResponseHeaders = event.headers;
  };

  /**
   * `loadingFinished` is the only event that actually awaits I/O
   * (`getResponseBody`). To avoid the redirect-style race, we capture the
   * entry reference synchronously, drop it from the map, and only then
   * await — sibling events for the same requestId would have already
   * landed before this fires (CDP guarantees ordering for events tied to a
   * single request).
   */
  private onLoadingFinished = (event: LoadingFinishedEvent): void => {
    const entry = this.pending.get(event.requestId);
    if (entry === undefined) return;
    this.pending.delete(event.requestId);
    if (entry.blocked) return;
    if (entry.response === undefined) {
      this.stats.totalFailed += 1;
      this.enqueueRecord(
        buildMetadataRecord({
          targetUri: entry.url,
          fields: {
            incomplete: "true",
            reason: "loadingFinished-without-response",
            requestId: event.requestId,
            ...(entry.resourceType && { resourceType: entry.resourceType }),
          },
        }),
      );
      return;
    }
    void this.fetchBodyAndRecord(event, entry, entry.response);
  };

  private async fetchBodyAndRecord(
    event: LoadingFinishedEvent,
    entry: PendingRequest,
    response: ResponseSnapshot,
  ): Promise<void> {
    // Pre-fetch size guard: `encodedDataLength` is the on-the-wire size which
    // approximates the decoded body size for non-compressed bodies.
    const declared = event.encodedDataLength;
    // Carried to the metadata record, which otherwise has only the figure from
    // `responseReceived` — the headers alone, off by whatever the body weighed.
    entry.transferSize = declared;
    if (
      declared > this.opts.limits.maxResponseBytes ||
      this.stats.totalBodyBytes >= this.opts.limits.maxTaskBytes
    ) {
      entry.skipBody = true;
      entry.skipBodyReason =
        this.stats.totalBodyBytes >= this.opts.limits.maxTaskBytes
          ? "task-cap"
          : "too-large";
    }

    let body: Buffer | undefined;
    if (!entry.skipBody && this.session !== null) {
      try {
        const result = await this.session.send("Network.getResponseBody", {
          requestId: event.requestId,
        });
        const buf = result.base64Encoded
          ? Buffer.from(result.body, "base64")
          : Buffer.from(result.body, "utf-8");
        if (buf.byteLength > this.opts.limits.maxResponseBytes) {
          entry.skipBody = true;
          entry.skipBodyReason = "too-large";
        } else if (
          this.stats.totalBodyBytes + buf.byteLength >
          this.opts.limits.maxTaskBytes
        ) {
          entry.skipBody = true;
          entry.skipBodyReason = "task-cap";
        } else {
          body = buf;
        }
      } catch (err) {
        // Body eviction (data:URL, websocket, redirect-without-body, etc.)
        // is normal — fall through with no body.
        this.logger.debug(
          { err, requestId: event.requestId, url: entry.url },
          "getResponseBody failed; recording response without body",
        );
      }
    }

    this.recordPair(entry, response, body);
  }

  private onLoadingFailed = (event: LoadingFailedEvent): void => {
    const entry = this.pending.get(event.requestId);
    if (entry === undefined) return;
    this.pending.delete(event.requestId);
    if (entry.blocked) return;
    this.stats.totalFailed += 1;
    this.enqueueRecord(
      // #region metadata-loadingfailed
      buildMetadataRecord({
        targetUri: entry.url,
        fields: {
          incomplete: "true",
          reason: "loadingFailed",
          errorText: event.errorText,
          canceled: String(event.canceled ?? false),
          method: entry.method,
          resourceType: event.type, // loadingFailed always carries a ResourceType
          ...(event.blockedReason && { blockedReason: event.blockedReason }),
          ...(entry.response && { status: String(entry.response.status) }),
        },
      }),
      // #endregion
    );
  };

  // ─── Record building (sync) ──────────────────────────────────────────

  /**
   * Build the request + response record pair (and optional metadata
   * truncation record) and enqueue them for ordered writing. Stat
   * increments happen here so the next caller observes accurate counters
   * before the bytes actually hit disk.
   */
  private recordPair(
    entry: PendingRequest,
    response: ResponseSnapshot,
    body: Buffer | undefined,
  ): void {
    // Stat updates first.
    if (entry.skipBody) {
      switch (entry.skipBodyReason) {
        case "content-type":
          this.stats.totalSkippedContentType += 1;
          pushSample(this.stats.samples.skippedContentType, entry.url);
          break;
        case "too-large":
          this.stats.totalTruncatedTooLarge += 1;
          pushSample(this.stats.samples.truncatedTooLarge, entry.url);
          break;
        case "task-cap":
          this.stats.totalTruncatedTaskCap += 1;
          pushSample(this.stats.samples.truncatedTaskCap, entry.url);
          break;
        case undefined:
          break;
      }
    } else {
      this.stats.totalRecorded += 1;
      if (body !== undefined) {
        this.stats.totalBodyBytes += body.byteLength;
      }
    }

    // Build the WARC `application/http;msgtype=request` payload. Strip
    // HTTP/2 pseudo-headers and synthesise a `Host` header so the result
    // is a parseable HTTP/1.1 request line + headers (the form wabac.js /
    // pywb / warcio expect inside the WARC).
    const requestHeadersMap = buildHttp11RequestHeaders(
      entry.fullRequestHeaders ?? entry.basicRequestHeaders,
      entry.url,
    );
    const requestHttpHeaders: HttpHeader[] =
      cdpHeadersToList(requestHeadersMap);
    const requestBytes = buildHttpRequestBytes({
      method: entry.method,
      path: extractRequestTarget(entry.url),
      // No httpVersion — defaults to HTTP/1.1 in the builder, which is the
      // only version permitted in the WARC `application/http` payload.
      headers: requestHttpHeaders,
      ...(entry.postData !== undefined && { body: entry.postData }),
    });

    // Build the WARC `application/http;msgtype=response` payload. Three
    // normalisations vs. raw CDP output:
    //   1. Strip HTTP/2 pseudo-headers and re-encoded `content-encoding` /
    //      `transfer-encoding` / original `content-length` (the body is
    //      already decoded by `Network.getResponseBody` — leaving the
    //      encoding header would make wabac.js try to Brotli-decode plaintext).
    //   2. Re-add a correct `Content-Length` for the decoded body so HTTP
    //      parsers know exactly how many bytes the body is.
    //   3. Always emit HTTP/1.1 status line with a non-empty reason phrase
    //      (CDP gives empty `statusText` for HTTP/2 responses).
    // A dropped body is still a body we are accounting for: say zero rather
    // than repeat the origin's figure for bytes the archive does not hold.
    const statesOwnLength = body !== undefined || entry.skipBody;
    const responseHeadersMap = buildHttp11ResponseHeaders(
      entry.fullResponseHeaders ?? response.headers,
      statesOwnLength,
    );
    const responseHttpHeaders: HttpHeader[] =
      cdpHeadersToList(responseHeadersMap);
    if (statesOwnLength) {
      responseHttpHeaders.push({
        name: "Content-Length",
        value: String(body?.byteLength ?? 0),
      });
    }
    const responseBytes = buildHttpResponseBytes({
      status: response.status,
      statusText: fallbackStatusText(response.status, response.statusText),
      // No httpVersion — defaults to HTTP/1.1 in the builder.
      headers: responseHttpHeaders,
      ...(body !== undefined && { body }),
    });

    const date = new Date().toISOString();

    const mime = response.mimeType ?? "";
    this.enqueueRecord(
      buildResponseRecord({
        recordId: entry.responseRecordId,
        concurrentTo: entry.requestRecordId,
        date,
        targetUri: entry.url,
        bytes: responseBytes,
        // Zero bytes is a payload with a digest like any other, and CDXJ 0.1.0
        // requires `digest` on every line. Falling back to the empty buffer
        // here rather than in the index keeps `WARC-Payload-Digest` and the
        // CDXJ entry agreeing — computed once, from the same bytes.
        payload: body ?? EMPTY_PAYLOAD,
        // Only the size caps truncate. `content-type` skips never fetch the
        // body at all, so there is nothing cut short to declare.
        ...((entry.skipBodyReason === "too-large" ||
          entry.skipBodyReason === "task-cap") && {
          truncated: "length" as const,
        }),
        ...(response.remoteIPAddress !== undefined && {
          ipAddress: response.remoteIPAddress,
        }),
      }),
      (info) => {
        const recorded: RecordedResponse = {
          url: entry.url,
          date,
          status: response.status,
          mime,
          offset: info.offset,
          length: info.length,
        };
        if (info.payloadDigest !== undefined) {
          recorded.payloadDigest = info.payloadDigest;
        }
        if (entry.skipBodyReason !== undefined) {
          recorded.bodySkipReason = entry.skipBodyReason;
        }
        this.recordedResponses.push(recorded);
      },
    );
    this.enqueueRecord(
      buildRequestRecord({
        recordId: entry.requestRecordId,
        concurrentTo: entry.responseRecordId,
        date,
        targetUri: entry.url,
        bytes: requestBytes,
        ...(entry.postData !== undefined && { payload: entry.postData }),
      }),
    );
    if (entry.skipBody && entry.skipBodyReason !== undefined) {
      this.enqueueRecord(
        buildMetadataRecord({
          targetUri: entry.url,
          refersTo: entry.responseRecordId,
          fields: {
            truncated: entry.skipBodyReason,
            // The whole transfer, from `loadingFinished`. The snapshot's own
            // `encodedDataLength` is what had arrived by `responseReceived` —
            // the headers — which would file a dropped 21 MiB body as ~156
            // bytes and leave this record explaining nothing.
            ...(entry.transferSize !== undefined && {
              encodedDataLength: String(entry.transferSize),
            }),
          },
        }),
      );
    }
  }
}
