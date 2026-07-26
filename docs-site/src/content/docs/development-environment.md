---
title: Development environment
description: Host-side development against the Apple Container stack — dev loop, watching workers, browsing artifacts
---

The stack (SeaweedFS + chromium workers + the server) runs on
[Apple Container](https://github.com/apple/container); the server code you
are editing runs **on the host**. There is no dev container.

## Full stack (when you just need a running BrowserHive)

```sh
container-compose up -d -b                   # SeaweedFS + 1 worker + browserhive:prod
container-compose --profile scale3 up -d -b  # …or with 3 workers
container-compose down                       # stop (pass the same --profile flags you used with up;
                                             #  artifacts survive in the volume)

# readiness is yours to check (compose does not wait):
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
```

## Host dev loop (when you are changing the server)

Start the stack once, then run your work-in-progress server on the host
against the same workers and S3 — the platform DNS names resolve from the
host too, so the wiring is static:

```sh
npm ci
npm run build
BROWSERHIVE_BROWSER_URLS=http://chromium-1.browserhive:9222 \
BROWSERHIVE_S3_ENDPOINT=http://seaweedfs.browserhive:8333 \
BROWSERHIVE_S3_BUCKET=browserhive \
BROWSERHIVE_S3_ACCESS_KEY_ID=browserhive \
BROWSERHIVE_S3_SECRET_ACCESS_KEY=browserhive \
BROWSERHIVE_S3_FORCE_PATH_STYLE=true \
LOG_LEVEL=info npm run server | pino-pretty
```

`npm ci` also builds the linked `meadow` fixture dep (`file:./meadow`) via its
`prepare` script — no separate build step is needed.

(Stop the containerized server first — `container stop browserhive.browserhive` —
if you want port 8080 for the host process.)

Override individual settings ad hoc by either setting another env var or by
passing the equivalent CLI flag (CLI > env > default). See
[Environment variables](/environment-variables/) for the full list.

CLI flags override env values; mix and match as needed:

```sh
LOG_LEVEL=info npm run server -- \
  --reject-duplicate-urls \
  --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36" \
  | pino-pretty
```

## Example: data client

An example client that sends capture requests from a YAML data file
(fire-and-forget). The format and parser live in
[`examples/data-file.ts`](https://github.com/uraitakahito/browserhive/blob/main/examples/data-file.ts).
The client sends requests and receives acceptance confirmations; the
actual captures are processed asynchronously by the server — check the
server logs for completion.

The example ships as TypeScript source only, and the production `npm run
build` compiles just `src` + `bin` — use `build:examples`, which also emits
`dist/examples/`. Point it at a running server (the host dev loop above, or
the container stack); by default it targets `localhost:8080`.

```sh
npm run build:examples
node dist/examples/data-client.js \
  --data data/smoke-test.yaml --webp --html --links --limit 30 \
  --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" \
  | pino-pretty
```

## Watching Chromium render

Workers are headless; watch them through the DevTools screencast:
open `chrome://inspect/#devices` in the host Chrome, register
`<worker-ip>:9222` under **Configure…**, and click **inspect** — the page
renders live even in headless mode. Full walkthrough (including the
wrong-port pitfall) in the chromium-server docs:
[Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/).
One-shot CDP checks: `./chromium-server-docker/bin/cdp.sh smoke`.

### When it finishes too fast to watch — `--slow-mo`

A capture takes only a few seconds by default (about 6s for example.com), so it
is usually over before the screencast is open. Start with `--slow-mo` and
**every CDP operation is spaced out**, letting you follow it step by step:

```yaml
# add to the browserhive service in docker-compose.yml, then recreate
environment:
  - BROWSERHIVE_SLOW_MO_MS=250
```

The `slowMo` field in the startup log confirms it took effect. Measured
(example.com, one PNG):

| `slowMo` | Time for one capture |
|---|---|
| `0` (default) | ~6s |
| `250` | ~10s |
| `1000` | ~33s |

- It is a **connect-time** option: it applies to every worker and changing it
  needs browserhive recreated (it cannot be switched per request).
- What slows down is the **gap between puppeteer operations**, not the page's
  own rendering or scrolling. To watch scrolling itself, raise
  `behaviors.options.autoscroll.stepDelayMs` on the request.
- Too large a value runs into `--task-timeout` (130s by default) and the task
  fails. The numbers above leave room even at `1000`, but a heavy page eats
  into that margin.

## Browsing captured artifacts in SeaweedFS

The Filer UI listens on the SeaweedFS container (nothing is published to
host ports — the DNS name resolves on this Mac only):
`http://seaweedfs.browserhive:8888/buckets/browserhive/`.

From inside the SeaweedFS container:

```sh
container exec seaweedfs.browserhive sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```
