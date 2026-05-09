# WACZ Internals

How BrowserHive turns a single Chromium capture into a
[ReplayWeb.page](https://replayweb.page/)-compatible WACZ archive.

## File layout

```
{taskId}_..._labels.wacz                 # zip archive
├── archive/
│   └── data.warc.gz                     # WARC 1.1 — every HTTP exchange
├── pages/
│   └── pages.jsonl                      # page-list (single entry, this capture)
├── indexes/
│   └── index.cdxj                       # CDXJ — surt-sorted, plain (see gotcha below)
├── fuzzy.json                           # cache-buster strip-rule list (Phase 6.4)
└── datapackage.json                     # manifest — sha256 + bytes per file
```

The zip is built once per task in `src/storage/wacz/packager.ts`. Each
inner file is computed in memory (capture sizes are bounded by the
per-task cap), hashed for `datapackage.json`, then appended to the zip.
`archive/data.warc.gz` is stored without re-compression — it's already
gzipped per WARC spec, and double-deflate would only inflate.

## WARC pipeline

The WARC writer (`src/storage/warc/`) emits one **independent gzip
member** per record — the gzip format guarantees that concatenated
members decompress as the concatenation of their payloads, which is
what the CDXJ index relies on to seek to a record by byte offset.

Records emitted per task:

| Record type | Source | Notes |
|---|---|---|
| `warcinfo` | `NetworkRecorder.start()` | Once per WARC. Carries `software`, `format`, `conformsTo`. |
| `request` | `loadingFinished` | Paired with `response` via `WARC-Concurrent-To`. Cookie / Authorization preserved (`*ExtraInfo` overrides). |
| `response` | `loadingFinished` | HTTP status line + headers + body. `Set-Cookie` preserved. |
| `metadata` | `loadingFailed`, body too large, body skipped, in-flight at `stop()` | Documents *why* a resource is missing without dropping the URL silently. |

Body bytes go through three independent caps (see `RecordingLimits`):

1. **`maxResponseBytes`** — per-response. Larger bodies become a
   `metadata { truncated: too-large }` record.
2. **`maxTaskBytes`** — cumulative. Once cleared, every subsequent
   response logs `metadata { truncated: task-cap }`.
3. **`maxPendingRequests`** — caps the in-flight tracking map (FIFO
   eviction when exceeded).

## CDXJ index

One line per `response` record, format
`<surt-url> <yyyymmddhhmmss> <json>`, sorted lexicographically. The
JSON object carries the fields ReplayWeb.page reads to seek into the
WARC: `url`, `mime`, `status`, `digest` (sha256 base32), `length`,
`offset`, `filename`. Lines are NOT deduped by URL — the same URL fired
twice (e.g. once on first load, once after a state change) produces two
CDXJ lines, which lets the replay engine pick the closest-by-timestamp
response for a given page snapshot.

## Replay correctness contracts

| Phase | Contract | Implementation |
|---|---|---|
| **6.1 Clock fixing** | `pages.jsonl.ts` and `datapackage.mainPageDate` equal capture-start time. ReplayWeb.page uses this to pin `Date.now()` / `Date()` / `Math.random()` / `crypto.getRandomValues()` for replayed JS. | `PageCapturer.capture` sets `capturedAt = new Date(startTime).toISOString()` once at the top of the function and passes it to `WaczPackager.pack`. |
| **6.2 Header completeness** | Cookie / Set-Cookie / Authorization preserved verbatim in WARC. | `NetworkRecorder` always prefers `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` headers when present (regardless of arrival order). The basic events strip security-sensitive headers; ExtraInfo is the unredacted source. |
| **6.3 Static-ization (multiple responses)** | Same URL → multiple WARC records → multiple CDXJ lines. Replay picks closest-by-timestamp. | Phase 1 writer is dedupe-free by design; CDXJ generator emits one line per response without any URL-based collapsing. |
| **6.4 Fuzzy match** | `fuzzy.json` lists query parameter names treated as cache-busters. Replay engines that honour the file (and BrowserHive's own viewer documentation) strip these before matching URLs. | `--wacz-fuzzy-param` flag → `WaczConfig.fuzzyParams` → `WaczPackager.pack({ fuzzyParams })` → `archive root/fuzzy.json`. ReplayWeb.page also has its own built-in cache-buster heuristic — `fuzzy.json` is forward-looking. |

## Concurrency model

CDP `Network.*` events fire synchronously to the EventEmitter. Multiple
events for one `requestId` (`requestWillBeSent` with redirect → next
`responseReceived` → `loadingFinished`) can land in tight succession
before any `await` yields. Two rules keep the recorder consistent:

1. **Map updates synchronously** — every change to `pending` happens
   inside an event handler before any `await`, so a redirect's
   `requestWillBeSent` swaps the slot for the next step before the
   sibling `responseReceived` handler can read the wrong entry.
2. **Writes serialized via `writeQueue`** — record building stays
   synchronous; the `WarcWriter.writeRecord` calls are chained on a
   single `Promise<void>` so concatenated gzip members never interleave
   (which would produce an unreadable file).

## Future scroll integration

`NetworkRecorder` is attached at the very top of `PageCapturer.capture`
and detached just before `resetPageState` runs (so `about:blank` is not
recorded). When a future `scrollBeforeCapture` step is added between
`page.goto` and the format captures, every request the scroll triggers
is automatically in the WARC — no WACZ-side changes needed.

## Spec-vs-implementation gotchas (lessons from E2E debugging)

WACZ has a written spec at <https://specs.webrecorder.net/wacz/1.0.0/>
**and** a reference implementation in
[wabac.js](https://github.com/webrecorder/wabac.js). Several of these
diverge in ways that matter — the WACZ won't replay if you only follow the
spec. The list below records every discrepancy BrowserHive's WACZ output
had to work around (each cost a manual ReplayWeb.page round-trip to
diagnose).

### CDX index file extension: `.cdxj` only, not `.cdxj.gz`

The spec says `.cdxj.gz` (gzipped CDXJ) is acceptable. wabac.js's
`multiwacz.ts:loadIndex` only matches `.cdx`, `.cdxj`, or `.idx`:

```typescript
if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) { ... }
```

A `.cdx.gz` / `.cdxj.gz` file lands in *no* branch and is silently skipped
— every URL lookup then returns "Archived Page Not Found". BrowserHive
emits **plain `indexes/index.cdxj`**; the outer zip's deflate covers size.

### CDXJ `filename` is relative to `archive/`

Spec wording is ambiguous; wabac prepends `archive/` itself when fetching
the WARC. Writing `"filename":"archive/data.warc.gz"` produces a 404
because wabac looks up `archive/archive/data.warc.gz`. Use `"filename":"data.warc.gz"`.

### CDXJ JSON values must be strings, not numbers

Per the wacz-creator / pywb convention, `status`, `length`, `offset` are
emitted as strings (`"200"`, not `200`). wabac is forgiving about types
during parsing, but reference WACZ files all use strings — diverging
costs nothing and reproduces other tools' output byte-for-byte.

### `datapackage.json` requires `profile: "data-package"`

The Frictionless Data Package spec mandates `profile`; the WACZ spec
inherits it. wabac's `loadPackage` switches on `root.profile`:

```typescript
switch (root.profile) {
  case "data-package":
  case "wacz-package":
  case undefined:
  case null:
    return await this.loadLeafWACZPackage(root);  // normal path
  case "multi-wacz-package":
    return await this.loadMultiWACZPackage(root);
  default:
    throw new Error(`Unknown package profile: ${root.profile}`);
}
```

`undefined`/`null` *do* fall through to `loadLeafWACZPackage`, but other
parts of the loader treat the absence of `profile` as a sign the WACZ is
incomplete and silently skip optional steps (like CDX validation). Always
emit `"profile": "data-package"`.

### WARC `application/http;msgtype=response` must be HTTP/1.1-shaped

Even when the wire transport is HTTP/2 (or HTTP/3), the WARC payload is
*always* HTTP/1.1 in practice. CDP gives us HTTP/2 wire data verbatim,
which means BrowserHive normalises four things in `network-recorder.ts`:

| Wire (CDP) | WARC (HTTP/1.1) | Why |
|---|---|---|
| `HTTP/2.0 200` (no reason) | `HTTP/1.1 200 OK` | RFC 7230 status-line format; reason-phrase fallback table |
| `:authority`, `:method`, `:path`, `:scheme`, `:status` | (stripped) | `:`-prefixed names are illegal in HTTP/1.1 |
| (`:authority` stripped) | `Host: …` synthesised from URL | HTTP/1.1 needs `Host:` |
| `content-encoding: br` next to decoded body | (stripped) | `getResponseBody` returns plaintext; encoding header would make wabac re-decompress |
| `transfer-encoding: chunked` | (stripped) | Chunked is a wire concern; the body is now a single buffer |
| `content-length` of encoded form | `Content-Length: <decoded byte count>` | Length must match the actual body bytes in WARC |

The helpers `buildHttp11RequestHeaders` / `buildHttp11ResponseHeaders` /
`fallbackStatusText` perform these transformations. They run in
`recordPair`, so every WARC record going through the recorder is
HTTP/1.1-shaped regardless of upstream transport.

## What's deliberately NOT in the WACZ

- **Auth flows / live data / WebRTC** — out of scope (see
  [`docs/replay-quickstart.md`](replay-quickstart.md)).
- **Service Worker registrations from the captured page** — replay
  uses its own SW; the captured one would conflict.
- **Images / video bodies above `maxResponseBytes`** — recorded as
  `metadata { truncated: too-large }`. Tune the cap for media-heavy
  captures.
- **Default block-list traffic** (`google-analytics.com` etc.) —
  recorded as nothing. Override with `--wacz-block-pattern`.
