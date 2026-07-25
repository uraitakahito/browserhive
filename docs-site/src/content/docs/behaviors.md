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
