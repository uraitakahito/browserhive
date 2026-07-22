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
- The `curl` and `jq` commands

## Step 1 — Get the repository

```bash
git clone --recurse-submodules https://github.com/uraitakahito/browserhive.git
cd browserhive
```

## Step 2 — Bring the stack up

```bash
./bin/stack.sh up 2     # SeaweedFS + chromium worker×2 + BrowserHive
```

Everything starts as Apple Container containers (lightweight VMs).
Only BrowserHive's port 8080 is published to the host; the workers and S3
are reached directly on their per-container IPs (192.168.64.0/24).

| Component | Address | Purpose |
|-----------|---------|---------|
| BrowserHive API | http://localhost:8080 | Accepts captures |
| SeaweedFS S3 / Filer | `http://<seaweedfs-ip>:8333` / `:8888` | Artifact store (IP from `container ls`) |
| chromium workers | `http://<worker-ip>:9222` (printed by stack.sh up) | CDP; watch via `chrome://inspect` |

Verify it is up:

```bash
./bin/stack.sh status
# or
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready", "ready"] }
```

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
The easiest way to browse them is the **Filer UI** in a browser
(get `<seaweedfs-ip>` from `container ls`):

```text
http://<seaweedfs-ip>:8888/buckets/browserhive/
```

With the AWS CLI (authentication required — default credentials are
browserhive/browserhive):

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://<seaweedfs-ip>:8333" \
  s3 ls s3://browserhive/

# Download the WACZ (taskId from the Step 3 response)
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://<seaweedfs-ip>:8333" \
  s3 cp s3://browserhive/550e8400-e29b-41d4-a716-446655440000.wacz ./capture.wacz
```

### Replay the WACZ in ReplayWeb.page

1. Open [replayweb.page](https://replayweb.page/)
2. "Choose File" → select `capture.wacz`
3. When the page list appears, click a URL to replay it

## Tear down

```bash
./bin/stack.sh down     # artifacts survive in the volume (seaweedfs-data)
```

---

## Next steps

- [API reference](/api/) — type definitions for every parameter (`dismissBanners` / `resetState` / `viewport`, …)
- [Architecture](/architecture/) — XState state machines and the internals
- To verify or watch a worker, see chromium-server's
  [Verifying workers](https://uraitakahito.github.io/chromium-server-docker/getting-started/verify/)
