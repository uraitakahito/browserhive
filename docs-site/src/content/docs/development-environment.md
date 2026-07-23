---
title: Development environment
description: Host-side development against the Apple Container stack — dev loop, watching workers, browsing and wiping artifacts
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

Build first (the example ships as TypeScript source only):

```sh
npm run build
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

## Browsing captured artifacts in SeaweedFS

The Filer UI listens on the SeaweedFS container (nothing is published to
host ports — the DNS name resolves on this Mac only):
`http://seaweedfs.browserhive:8888/buckets/browserhive/`.

From inside the SeaweedFS container:

```sh
container exec seaweedfs.browserhive sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```

## Wiping captured artifacts

### Wipe every artifact, keep the bucket (Filer HTTP API)

```sh
SW=seaweedfs.browserhive
curl -X DELETE "http://${SW}:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true" && \
  curl -X PUT  "http://${SW}:8888/buckets/browserhive/.keep" --data '' && \
  curl -X DELETE "http://${SW}:8888/buckets/browserhive/.keep"
```

### Reset the SeaweedFS state too

```sh
container-compose down
container volume rm browserhive_seaweedfs-data
container-compose up -d
```

Drops the `browserhive_seaweedfs-data` volume, taking the bucket and all
SeaweedFS metadata with it; the next `up` recreates the volume, and the
seaweedfs entrypoint recreates the bucket.
Reach for this when the SeaweedFS state itself looks wrong (corrupt
metadata, mismatched credentials), not for routine artifact cleanup.
