---
title: Production environment
description: Running the full stack (SeaweedFS + chromium workers + BrowserHive) on Apple Container with container-compose
---

The stack is declared in `docker-compose.yml` and driven by
[container-compose](https://github.com/Mcrich23/Container-Compose) on
[Apple Container](https://github.com/apple/container) (macOS 26+, Apple
silicon): a self-hosted SeaweedFS (bucket init built into its entrypoint),
1–3 headless chromium workers (built from the `chromium-server-docker`
submodule at its pinned release), and the BrowserHive production image.
All wiring is name-based — containers reach each other through the
platform DNS as `<service>.browserhive`, so no IPs are collected anywhere.
The DNS domain is a one-time machine setup (see Quickstart):
`sudo container system dns create browserhive`.

Only BrowserHive publishes a port (`127.0.0.1:8080`). SeaweedFS and the
workers are reachable on their DNS names (host-local).

```sh
container-compose up -d -b                     # 1 worker
container-compose --profile scale2 up -d -b    # 2 workers
container-compose --profile scale3 up -d -b    # 3 workers
container logs browserhive.browserhive

# wait until ready, then check
until curl -sf http://localhost:8080/v1/status >/dev/null; do sleep 1; done
curl -s http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
```

`BROWSERHIVE_BROWSER_URLS` declares the full set of workers, but the pool is
resolved from DNS: a declared host that is not running (NXDOMAIN) is excluded
at startup — not carried as an erroring worker — so `totalWorkers` and
`isRunning` reflect what actually exists. Membership is refreshed on an
interval, so starting more workers (`--profile scaleN up -d`) adds them to a
running browserhive **without a restart**, and stopping a worker retires it
from the pool. A worker that is present but unreachable (its CDP is down)
stays in the pool and is retried with capped exponential backoff — that is a
health concern, distinct from membership.

Stop with:

```sh
container-compose down                       # default (1-worker) stack
container-compose --profile scale3 down      # pass the same profiles you used
```

`down` only covers the services active under the given profiles — profile
workers are otherwise left running.

**Workers scale live.** Adding workers (`--profile scaleN up -d`) or
stopping/replacing one is reconciled into a running browserhive without a
restart — membership is discovered from DNS (verified: scale 1→3 and back
with no browserhive restart). For **seaweedfs and browserhive** themselves,
`up` *recreates* the running service, so treat a change to those as
`container-compose down && container-compose up -d` (in-flight captures do
not survive recreating browserhive).

> **Note:** The SeaweedFS data volume (`browserhive_seaweedfs-data`) holds
> every captured artifact and survives `down`/`up`. Plan its backup /
> lifecycle separately — `container volume rm browserhive_seaweedfs-data`
> wipes it. For external S3 deployments, the volume is unused.

To build the production image standalone (e.g. to push to a registry):

```sh
container build -f Dockerfile.prod -t browserhive:<version> .
```

Standalone run, pointing at an external S3-compatible store and existing
workers:

```sh
container run --rm -p 127.0.0.1:8080:8080 \
  -e BROWSERHIVE_BROWSER_URLS=http://<worker-ip>:9222 \
  -e BROWSERHIVE_S3_ENDPOINT=https://s3.example.com \
  -e BROWSERHIVE_S3_BUCKET=browserhive \
  -e BROWSERHIVE_S3_ACCESS_KEY_ID=... \
  -e BROWSERHIVE_S3_SECRET_ACCESS_KEY=... \
  browserhive:<version>
```
