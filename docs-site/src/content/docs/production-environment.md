---
title: Production environment
description: Running the full stack (SeaweedFS + chromium workers + BrowserHive) on Apple Container with bin/stack.sh up
---

The stack runs on [Apple Container](https://github.com/apple/container)
(macOS 26+, Apple silicon): a self-hosted SeaweedFS with one-shot bucket
init, N headless chromium workers (built from the `chromium-server-docker`
submodule at its pinned release), and the BrowserHive production image.
`bin/stack.sh up` supplies all required `BROWSERHIVE_*` configuration — worker
URLs and the S3 endpoint are collected as container IPs at startup and
baked into the environment.

Only BrowserHive publishes a port (`127.0.0.1:8080`). SeaweedFS and the
workers are reachable solely on their per-container IPs
(`192.168.64.0/24`, host-local).

```sh
./bin/stack.sh up 2                        # or 4, 8, ...
container logs browserhive

# verify
curl http://localhost:8080/v1/status
./bin/stack.sh status
```

Stop with:

```sh
./bin/stack.sh down
```

Restarting is always `./bin/stack.sh down && ./bin/stack.sh up N` — container IPs
change across restarts, so partial restarts are unsupported by design.

> **Note:** The SeaweedFS data volume (`seaweedfs-data`) holds every
> captured artifact and survives `stack.sh down`/`stack.sh up`. Plan its backup /
> lifecycle separately — `container volume rm seaweedfs-data` wipes it.
> For external S3 deployments, the volume is unused.

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
