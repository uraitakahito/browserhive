---
title: Behaviors
description: In-page scripts injected during capture — built-in autoscroll / autofetch / autoplay, per-request tuning, and client-supplied custom behaviors
---

**Behaviors** are small scripts BrowserHive injects into every captured page to
automate interaction, so resources that only load on scroll / play / click are
archived. The runtime (`src/behaviors/runtime/`) is bundled into one script and
injected; each behavior is a cooperative async generator that `yield`s at
checkpoints, and the whole pass is bounded by `--behavior-timeout` so it can
never hang the worker.

## Built-in behaviors

Enabled by **flag or config — no client JavaScript required**.

| id | default | what it does |
|----|---------|--------------|
| `autoscroll` | **on** | Scrolls the full document height so `loading="lazy"` / IntersectionObserver / `data-src` loaders fire and their resources are recorded. Returns to the top for the screenshot. |
| `autofetch` | **on** | Actively fetches **every** `srcset` candidate (1x/2x, small/medium/large), `data-*` lazy attribute, and same-origin stylesheet `url(...)` — even the ones the capture viewport/DPR did not select. Makes replay **DPR/viewport-complete** (fixes the Retina `_2x` gap). |
| `autoplay` | off (opt-in) | Muted-plays `<video>` / `<audio>` and fetches their `src` / `<source>` / `poster` so media is archived. Can be large. |

The default enabled set is `autoscroll,autofetch`. Behaviors run in the order
listed.

## Enabling behaviors

### Server-wide (flags / env)

```sh
node dist/bin/main.js server \
  --behaviors autoscroll,autofetch,autoplay \  # order = execution order; "" disables all
  --behavior-timeout 30000                     # overall budget (ms)
# env: BROWSERHIVE_BEHAVIORS / BROWSERHIVE_BEHAVIOR_TIMEOUT_MS
```

See [Environment variables](/environment-variables/) for the full flag ↔ env map.

### Per request

The `POST /v1/captures` body accepts a `behaviors` object. `builtins` replaces
the server default set for that capture; `options` are merged over the server
options, keyed by behavior id.

```json
{
  "url": "https://www.apple.com/",
  "captureFormats": { "wacz": true },
  "behaviors": {
    "builtins": ["autoscroll", "autofetch"],
    "options": { "autoscroll": { "maxSteps": 60 } }
  }
}
```

## Custom behaviors

Clients can add arbitrary automation by sending JavaScript — no server change
needed. Each custom behavior is a **class expression** implementing the
interface, sent in `behaviors.custom`. This is also how you do **site-specific**
automation: gate it with `isMatch()` on the hostname.

```json
{
  "url": "https://example.com/feed",
  "captureFormats": { "wacz": true },
  "behaviors": {
    "custom": [
      {
        "id": "loadMore",
        "source": "class { static id='loadMore'; static isMatch(){ return location.hostname === 'example.com'; } async *run(ctx){ let b; while ((b = document.querySelector('button.more'))) { b.click(); await ctx.Lib.sleep(1500); yield ctx.getState('clicked','clicks'); } } }"
      }
    ]
  }
}
```

The behavior interface (browser side):

```ts
class MyBehavior {
  static id = "myBehavior";
  static isMatch(): boolean { /* run on this page? (URL / DOM) */ return true; }
  async *run(ctx: BehaviorCtx) {
    // ctx.Lib: sleep, collectCandidateUrls, collectStyleSheetUrls, scrollIntoView
    // ctx.opts: per-behavior options; ctx.getState(msg, counter): yield checkpoint
    yield ctx.getState("step 1");
  }
}
```

:::caution
Custom behaviors are **arbitrary code** running in the capture browser, so they
are **off by default**. Start the server with `--allow-custom-behaviors`
(`BROWSERHIVE_ALLOW_CUSTOM_BEHAVIORS=true`) to accept them; otherwise the
`custom` field is ignored. They can `fetch()` from the page and reach whatever
the capture browser can reach — bound egress at your network boundary and treat
enabling them as granting code execution to clients.
:::

### Organizing custom behaviors by site (example client)

The bundled example client (`examples/data-client.ts`) keeps custom behaviors on
disk, **one directory per site**, and attaches them automatically based on each
target URL's host — so most site-specific automation is just a file you drop in,
with no per-request wiring:

```
examples/behaviors/
└─ <version>/                    # runtime-contract version, e.g. v1.0
   ├─ www.apple.com/             # FQDN — most specific
   │  └─ tv-gallery.js
   └─ apple.com/                 # registrable domain — all subdomains
      └─ promo-carousel.js
```

Each `<name>.js` is a bare **class expression** (the same shape shown above). By
convention its `static id` equals `"<dir>:<basename>"` (e.g.
`www.apple.com:tv-gallery`) — the client sends that id, and the runner matches
enabled ids to registered classes by `static id`.

Pick the version directory with `--behaviors-version` (default `v1.0`). For each
entry the client loads the FQDN directory then the registrable-domain directory
and sends the result as `behaviors.custom`:

```sh
# the server must allow custom behaviors
node dist/bin/main.js server --allow-custom-behaviors
# the client resolves the base URL from --server / BROWSERHIVE_SERVER / the SDK
# default (no URL is hardcoded) and attaches behaviors by host
node dist/examples/data-client.js --data data/apple.yaml --wacz --behaviors-version v1.0
```

Only `custom` is sent, never `builtins`: the built-in set (`autoscroll`,
`autofetch`, …) is left to the server's own `--behaviors` configuration so the
client cannot accidentally disable it.

:::tip[Want to watch it happen?]
If a capture finishes too fast to follow, add `operationDelayMs` to the request and
that capture alone is paced one operation at a time — see
[Development environment](/development-environment/).
:::

### Retina (2x) fidelity — capture at DPR 2

Some sites (e.g. `apple.com`) render **one image variant per device pixel
ratio**: the slide `<img>` carries no `srcset`, and its URL is chosen from
`window.devicePixelRatio`. A default DPR-1 capture then only fetches the 1x, so
the `2x` a Retina replay requests is missing and the image renders black.

Capture at **DPR 2** so the browser fetches the `2x` itself:

```sh
node dist/examples/data-client.js --data data/apple.yaml --wacz --device-scale-factor 2
```

Hitting the HTTP API directly, pass `deviceScaleFactor: 2` in the request (and
keep `captureFormats.wacz` true so the archive is written). `operationDelayMs` is
there because **without it the capture is over in seconds and there is nothing to
watch** in `chrome://inspect` — drop it if you are not observing:

```bash
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.apple.com/jp/",
    "labels": ["apple-jp"],
    "deviceScaleFactor": 2,
    "operationDelayMs": 250,
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "mhtml": false,
      "wacz": true
    }
  }' | jq .
```

To confirm the `2x` really landed, look at the finished WACZ's CDXJ (apple's
slides should show `1960x1044` rather than the 1x `980x522`):

```bash
# the artifact key is <taskId>_<labels>.wacz (plus correlationId when you send one)
curl -s -o out.wacz \
  "http://seaweedfs.browserhive:8888/buckets/browserhive/92fc7fb0-…_apple-jp.wacz"
unzip -p out.wacz indexes/index.cdxj | grep -o '[0-9]\{3,4\}x[0-9]\{3,4\}' | sort | uniq -c
#   18 1960x1044   ← the 2x is present (a DPR-1 capture shows 980x522)
```

or set the server default with `BROWSERHIVE_DEVICE_SCALE_FACTOR=2` /
`--device-scale-factor 2`. Note DPR 2 also doubles the pixel dimensions of any
PNG / WebP screenshot.

### Both 1x and 2x in one WACZ — `archiveMode: multipass`

Because each variant is DPR-specific and dropped from the DOM after hydration,
**a single pass cannot hold both** the 1x and the 2x (capture at DPR 2 and you
get only the 2x; at DPR 1 only the 1x). When you need both, set `archiveMode` to
`multipass` — it loads the same page **once per device pixel ratio (1 and 2) into
a single WACZ**:

```bash
curl -s -X POST http://localhost:8080/v1/captures \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.apple.com/jp/",
    "labels": ["apple-jp"],
    "archiveMode": "multipass",
    "captureFormats": {
      "png": false, "webp": false, "html": false,
      "links": false, "mhtml": false, "wacz": true
    }
  }' | jq .
```

Each pass is fetched with the **browser cache disabled**: a pass served from
cache would defeat the point, and a revalidated `304` carries no body, which
would leave holes in the archive.

Measured on apple.com/jp: single-pass archived only `1960x1044` ×9, while
**multipass archived `980x522` ×9 *and* `1960x1044` ×9**. The cost is roughly
double — 409 → 751 records, 77MB → 123MB, and about twice the wall time.
`deviceScaleFactor` is ignored (the mode sweeps its own ratios), and PNG / WebP
screenshots come from the last pass, i.e. at DPR 2.

Server-wide: `--archive-mode multipass` / `BROWSERHIVE_ARCHIVE_MODE=multipass`.
Sites that declare their candidates in `srcset` are already covered in one pass
by `autofetch`, so multipass only pays off for sites that **compute** image URLs
from the DPR.

## The behavior report

When at least one behavior runs, the completed-task server log line includes a
`behaviorReport`:

```json
{
  "msg": "Task completed",
  "url": "https://www.apple.com/",
  "behaviorReport": {
    "ran": [
      { "id": "autoscroll", "steps": 9, "ms": 3025 },
      { "id": "autofetch",  "steps": 29, "ms": 201 }
    ],
    "timedOut": false
  }
}
```

- `ran` — each behavior that actually ran (enabled ∩ `isMatch`), in execution
  order, with its `steps` (yield checkpoints), wall `ms`, and an `error` string
  if it threw.
- `timedOut` — `true` if the pass hit `--behavior-timeout` and remaining
  behaviors were skipped.
