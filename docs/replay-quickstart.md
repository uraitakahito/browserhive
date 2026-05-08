# WACZ Replay Quickstart

BrowserHive's `wacz` capture format records every HTTP exchange Chromium
performs during a capture (the navigation request, every CSS / image /
font / API call) into a single
[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archive. The result is
a fully replayable snapshot of the page — the rendered DOM, the network
chatter behind it, and (with future scroll wiring) any lazy-loaded
resources triggered by user interaction.

## Recording a capture

Send a request with `captureFormats.wacz: true`:

```sh
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.example.com/",
    "labels": ["example"],
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "pdf": false, "mhtml": false,
      "wacz": true
    }
  }'
```

The artifact is uploaded to the configured S3 bucket as
`s3://<bucket>/[<prefix>/]<taskId>_..._labels.wacz`. The worker's
`Task completed` log line carries the `s3://` URI plus a `waczStats`
object summarising what landed in the WARC:

```json
{
  "msg": "Task completed",
  "url": "https://www.example.com/",
  "waczLocation": "s3://browserhive/550e8400-..._example.wacz",
  "waczStats": {
    "totalRecorded": 12,
    "totalBlocked": 1,
    "totalSkippedContentType": 0,
    "totalTruncatedTooLarge": 0,
    "totalTruncatedTaskCap": 0,
    "totalFailed": 0,
    "totalIncomplete": 0,
    "totalBodyBytes": 348201
  }
}
```

## Opening a WACZ in ReplayWeb.page

The simplest path: download the `.wacz` from S3 and drag-and-drop into
[https://replayweb.page/](https://replayweb.page/). The viewer loads
the archive locally (the file never leaves your browser) and renders
the page exactly as Chromium saw it at capture time, replaying each
network request from the recorded WARC.

For an embedded viewer, drop the `replaywebpage` web component into your
own HTML:

```html
<!doctype html>
<script src="https://replayweb.page/sw.js"></script>
<script src="https://cdn.jsdelivr.net/npm/replaywebpage/ui.js"></script>

<replay-web-page
  source="https://your-bucket.s3.amazonaws.com/path/to/capture.wacz"
  url="https://www.example.com/"
  embed="replayonly"
></replay-web-page>
```

ReplayWeb.page intercepts every `fetch` / XHR the replayed page makes
and serves the matching response from the WARC. Where the URL doesn't
match exactly (cache-busters, time-dependent params), the viewer falls
back to its built-in fuzzy match heuristic; BrowserHive also ships a
`fuzzy.json` strip-rule list inside the WACZ root that future replay
engines can honour (the parameter list is configurable via
`--wacz-fuzzy-param`).

## What replays faithfully

BrowserHive's WACZ output covers the static-shape contract:

- **HTML, CSS, fonts, images, inline scripts** — the document and every
  resource it references.
- **JS-built URLs** — `fetch('/api/users/' + urlParam.id)` works as long
  as the live JS reconstructs the same URL given the same input.
- **Lazy-loaded images** — when scroll wiring lands, IntersectionObserver
  fires the same fetches at replay time, all of which are served from
  the WARC.
- **Cache-buster query params** — `?_=${Date.now()}` etc. are normalised
  by ReplayWeb.page's built-in fuzzy match (and BrowserHive's
  `fuzzy.json`) so the live URL still matches the recorded one.

## What does NOT replay (out of scope)

The recorder captures the original exchange faithfully, but **server-state
dependent dynamic traffic cannot replay** because replay-time JS would
have to invoke external state that no longer exists:

- **Authentication flows** — expiring JWTs, OAuth refresh, per-request
  CSRF tokens. Replay-time JS regenerates new tokens; the WARC has no
  matching response.
- **Live data** — real-time stock prices, chat WebSocket frames, SSE
  streams, WebRTC. The recorder captures the protocol but replay can't
  reproduce values that change every load.
- **Service Worker offline cache** — ReplayWeb.page itself uses a Service
  Worker; the captured page's SW registration is ignored at replay time.

If your capture target depends on these, downstream tooling should treat
WACZ as a forensic record (network truth at capture time) rather than a
replayable interactive snapshot.

## Tuning

| Concern | Knob | Default |
|---|---|---|
| Per-response body too big | `--wacz-max-response-bytes` | 20 MB |
| Cumulative body bloat | `--wacz-max-task-bytes` | 200 MB |
| Drop ads / analytics from the WARC | `--wacz-block-pattern` | bundled list (`*://*.google-analytics.com/*` etc.) |
| Skip video / audio bodies | `--wacz-skip-content-types` | (empty) |
| Fuzzy-strip cache-buster params | `--wacz-fuzzy-param` | `_,cb,nocache,t,nonce,timestamp,_t,_v,ts` |

Each flag has a `BROWSERHIVE_WACZ_*` env equivalent (see the README CLI
table). Variadic flags accept multiple values on the CLI; the env
form is comma-separated.

## Troubleshooting

- **Replayed page is missing images / CSS** — Check `waczStats` in the
  worker log: `totalBlocked > 0` indicates a block-pattern matched a
  resource the page actually needed. Tighten the pattern or use
  `--wacz-block-pattern ""` to start from no defaults.
- **`waczStats.totalTruncatedTaskCap > 0`** — The cumulative body cap
  was hit. Raise `--wacz-max-task-bytes` if the page legitimately has
  hundreds of MB of resources.
- **Replay shows "no matching response"** — Some resource fetched at
  replay time has no recorded counterpart, often because of a fresh
  cache-buster value the fuzzy match didn't catch. Add the parameter
  name to `--wacz-fuzzy-param`.
- **Auth-walled site looks broken on replay** — Expected (see "Out of
  scope" above). Capture a logged-out variant, or accept that replay is
  read-only for the static page state.

## See also

- WACZ spec: <https://specs.webrecorder.net/wacz/1.0.0/>
- WARC 1.1 spec: <https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/>
- ReplayWeb.page: <https://replayweb.page/>
- WACZ internals (BrowserHive's encoding decisions): [`docs/wacz-internals.md`](wacz-internals.md)
