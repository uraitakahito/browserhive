---
title: Quickstart
description: From bringing the stack up on Apple Container to your first WACZ capture, in 5 steps
sidebar:
  order: 1
---

Get BrowserHive running and take your first capture in 5 steps.

## Prerequisites

- **macOS 26+ / Apple silicon** with [Apple Container](https://github.com/apple/container)
  (`brew install container` → `container system start`)
- [container-compose](https://github.com/Mcrich23/Container-Compose)
  (`brew install container-compose`)
- One-time: `sudo container system dns create browserhive` — registers the
  local DNS domain that makes the stack's `<service>.browserhive` names
  resolve, from containers and from this Mac
- The `curl` and `jq` commands

## Step 1 — Get the repository

```bash
git clone --recurse-submodules https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — Bring the stack up

```bash title="SeaweedFS + chromium worker + BrowserHive + capping"
container-compose --profile signing up -d -b
```

`--profile signing` starts [capping](https://uraitakahito.github.io/capping/),
the local wacz-auth signing service. Leave it off and everything below still
works, except that a capture asking for `signing: true` comes back
`signature.signed: false` — the archive is written unsigned, the capture
succeeds, and nothing else indicates the service was missing. Starting it from
the outset avoids that.

Everything starts as Apple Container containers (lightweight VMs), wired
together by their platform DNS names. Only BrowserHive's port 8080 is
published to the host. The default is one chromium worker; add more with
`--profile scale2` or `--profile scale3` (up to three).

| Component | Address | Purpose |
|-----------|---------|---------|
| BrowserHive API | http://localhost:8080 | Accepts captures |
| SeaweedFS S3 / Filer | `http://seaweedfs.browserhive:8333` / `:8888` | Artifact store |
| chromium workers | `http://chromium-N.browserhive:9222` | CDP; watch via `chrome://inspect` |
| capping | `http://capping.browserhive:8080` | Signs a WACZ when a capture asks (`--profile signing`) |
| timestamp authority | `http://tsa.browserhive:3004` | RFC 3161 timestamps for capping's signatures (`--profile signing`) |

Check the state (until the stack is up, curl reports the failure itself):

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready"] }
```

`workers` above has a single entry even though `BROWSERHIVE_BROWSER_URLS` lists
three, because **only containers that are actually running get registered as
workers**: browserhive resolves each host against DNS and drops the ones whose
name does not resolve (i.e. not started by the active profile), logged once at
boot. Start more with `--profile scale2` / `scale3` — they are **picked up live,
without restarting browserhive**.

## Step 3 — Request your first capture

`POST /v1/captures` returns **202** as soon as the request is accepted
(the capture itself runs asynchronously).

```bash
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "captureFormats": {
      "png":   true,
      "webp":  false,
      "html":  false,
      "mhtml": false,
      "wacz":  true,
      "links": false
    }
  }' | jq .
```

Example response:

```json
{
  "accepted": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Keep the `taskId` handy.

:::tip[Why `--fail-with-body`]
A rejected request answers **400** with an RFC 7807
`application/problem+json` body whose `detail` names the offending field —
e.g. `/captureFormats must be object`, or every missing key at once when you
send a partial `captureFormats`. Plain `curl -s` prints that body but still
**exits 0**, so a pipeline reads a response with no `taskId` in it and moves on
to poll a task that was never created. `--fail-with-body` keeps the body and
exits non-zero (curl 7.76+). If you pipe into a `jq` filter, read stderr too:
the filter turns the problem body into `null`s and hides the reason.
:::

## Step 4 — Check progress

Ask about the task you submitted, using the `taskId` from Step 3:

```bash
curl -sS -o /tmp/result.json -w '%{http_code}\n' \
  http://localhost:8080/v1/captures/550e8400-e29b-41d4-a716-446655440000
```

- **202** — still queued or being captured. Poll again.
- **200** — finished. `/tmp/result.json` says how it went:

```bash
jq '{status, artifacts, errorDetails}' /tmp/result.json
```

`status` is `success` only when artifacts were produced; `failed`, `timeout`
and `httpError` mean nothing was uploaded and `errorDetails` says why. A
**404** means the task was never submitted, or its result aged out of the
in-memory cache (`--result-cache-size`, default 1000) — the same body is
also written to the bucket as `.result.json`, which survives both eviction
and a server restart. See [Capture results](/capture-results/).

For a fleet-wide view instead of one task, `/v1/status` reports the queue
depth and the `succeeded` / `failed` counters:

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{pending, processing, succeeded, failed}'
```

## Step 5 — Fetch the artifacts

Artifacts are stored in the `browserhive` bucket on SeaweedFS.
The easiest way to browse them is the **Filer UI** in a browser:

```text
http://seaweedfs.browserhive:8888/buckets/browserhive/
```

With the AWS CLI (authentication required — default credentials are
browserhive/browserhive):

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 ls s3://browserhive/

# Download the WACZ (taskId from the Step 3 response)
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### Replay the WACZ in ReplayWeb.page

1. Open [replayweb.page](https://replayweb.page/)
2. "Choose File" → select `capture.wacz`
3. When the page list appears, click a URL to replay it

## Developing: rebuild from the latest source

The BrowserHive image bakes the source in at build time (`Dockerfile.prod`), so
after changing code you must **rebuild the image** and recreate the container.
A plain `up -d` (without `-b`, build) reuses the old image and your changes will
not take effect.

Mid-development the stack is usually still up, so **take it down first**.
Containers left over from the previous run are not reliably replaced by the new
image, and when that happens the build succeeds while the server keeps serving
the old code — the confusing failure this section exists to avoid.

```bash title="Rebuild and replace — artifacts survive in the volume"
container-compose --profile signing down
GIT_REV=$(git rev-parse --short HEAD) container-compose --profile signing up -d -b
```

`GIT_REV` bakes the commit into the `build` field of `/v1/status`. **Check it
every time** — it is the only thing that tells you the running server is the
code you just built:

```bash
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '.build'
# → { "version": …, "revision": …, "buildTime": … }
# revision matches your HEAD (git rev-parse --short HEAD) when up to date
```

If `revision` is not your HEAD, the container is stale:
`container-compose --profile signing down` and build again.

To rebuild only browserhive and leave chromium / SeaweedFS running, remove that
one container instead of taking the stack down:

```bash
container stop browserhive.browserhive && container rm browserhive.browserhive
GIT_REV=$(git rev-parse --short HEAD) container-compose up -d -b browserhive
```

If you only changed environment variables (`docker-compose.yml`) no rebuild is
needed, but the container still has to be recreated for them to apply — same
`stop` + `rm`, then `container-compose up -d browserhive`.

## Tear down

```bash title="Artifacts survive in the browserhive_seaweedfs-data volume"
container-compose --profile signing down
```

---

## Next steps

- [API reference](/api/) — type definitions for every parameter (`dismissBanners` / `resetState` / `viewport`, …)
- [Architecture](/architecture/) — XState state machines and the internals
- [Specifications](/specifications/) — when you want to check a file you just
  produced against the standard. WACZ 1.1.1, wacz-auth and Data Package have
  Japanese translations
- To verify or watch a worker, see chromium-server's
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/)
