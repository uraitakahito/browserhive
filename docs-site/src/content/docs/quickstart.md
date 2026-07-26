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

```bash
container-compose up -d -b     # SeaweedFS + chromium worker + BrowserHive
```

Everything starts as Apple Container containers (lightweight VMs), wired
together by their platform DNS names. Only BrowserHive's port 8080 is
published to the host. The default is one chromium worker; add more with
`--profile scale2` or `--profile scale3` (up to three).

| Component | Address | Purpose |
|-----------|---------|---------|
| BrowserHive API | http://localhost:8080 | Accepts captures |
| SeaweedFS S3 / Filer | `http://seaweedfs.browserhive:8333` / `:8888` | Artifact store |
| chromium workers | `http://chromium-N.browserhive:9222` | CDP; watch via `chrome://inspect` |

Wait until it is up, then check:

```bash
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
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
curl -s -X POST http://localhost:8080/v1/captures \
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

## Step 4 — Check progress

```bash
curl -s http://localhost:8080/v1/status | jq '{completed, workers: [.workers[] | {health, processedCount}]}'
```

When `completed` increments and a worker's `processedCount` goes up, the
capture is done.

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

```bash
# Rebuild and recreate just browserhive (chromium / SeaweedFS keep running)
GIT_REV=$(git rev-parse --short HEAD) container-compose up -d -b browserhive
```

`GIT_REV` bakes the commit into the `build` field of `/v1/status`, so you can
confirm you are running the latest:

```bash
curl -s http://localhost:8080/v1/status | jq '.build'
# → { "version": …, "revision": …, "buildTime": … }
# revision matches your HEAD (git rev-parse --short HEAD) when up to date
```

To rebuild the whole stack, omit the service name:

```bash
GIT_REV=$(git rev-parse --short HEAD) container-compose up -d -b
```

If you only changed environment variables (`docker-compose.yml`) no rebuild is
needed, but recreate the container to be sure they apply:

```bash
container stop browserhive.browserhive && container rm browserhive.browserhive
container-compose up -d browserhive
```

## Tear down

```bash
container-compose down     # artifacts survive in the volume (browserhive_seaweedfs-data)
```

---

## Next steps

- [API reference](/api/) — type definitions for every parameter (`dismissBanners` / `resetState` / `viewport`, …)
- [Architecture](/architecture/) — XState state machines and the internals
- To verify or watch a worker, see chromium-server's
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/)
