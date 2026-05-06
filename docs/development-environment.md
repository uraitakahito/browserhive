# Development Environment

`compose.dev.yaml` brings up everything the server needs in one shot —
two Chromium servers, a self-hosted SeaweedFS (S3-compatible artifact
store), a one-shot `weed shell` init container that creates the
`browserhive` bucket, and the BrowserHive container itself. All
`BROWSERHIVE_*` env vars are already injected, so the in-container start
command takes no CLI flags:

```sh
GH_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up -d
docker exec -it browserhive-container /bin/zsh
```

`GH_TOKEN` is intentionally **not** stored in `.env`. The token is fetched from the host's `gh` CLI (macOS Keychain-backed) at launch time and exists only in the running container's environment. If you forget the prefix, the container will still start but Claude Code / `gh` inside it will be unauthenticated.

```sh
# inside the container, first time only:
sudo chown -R $(id -u):$(id -g) /zsh-volume

npm ci
npm run build
npm run server | pino-pretty
```

Override individual settings ad hoc by either setting another env var or by passing the equivalent CLI flag (CLI > env > default). See [Environment variables](../README.md#environment-variables) in the README for the full list.

Stop with:

```sh
docker compose -f compose.dev.yaml down
```

## Inspecting Chromium via noVNC

The dev compose stack runs the development image for both chromium servers, which embeds Xvfb + x11vnc + noVNC. Open these URLs from the host browser to watch the running Chromium:

| Server | noVNC (browser) | Raw VNC |
|--------|-----------------|---------|
| chromium-server-1 | http://localhost:6080/ | `localhost:5901` |
| chromium-server-2 | http://localhost:6081/ | `localhost:5902` |

## Browsing captured artifacts in SeaweedFS

The bundled SeaweedFS exposes its **Filer UI** at
<http://localhost:8888/buckets/browserhive/> — open it in a browser to
list and download every artifact. Default credentials are `browserhive`
/ `browserhive`, overridable via the `BROWSERHIVE_S3_ACCESS_KEY_ID` /
`BROWSERHIVE_S3_SECRET_ACCESS_KEY` env vars on `docker compose up`
(both the bundled SeaweedFS and the BrowserHive container read from the
same pair, so they always agree by construction).

Captured artifacts land at `s3://browserhive/<filename>`. From inside
the SeaweedFS container, you can also list them via:

```sh
docker exec browserhive-seaweedfs sh -c \
  'echo "fs.ls /buckets/browserhive" | weed shell -master=127.0.0.1:9333'
```

## Wiping captured artifacts

When iterating, you often want a clean slate without rebuilding the
whole stack. Three levels, each with a different blast radius:

### One file at a time (Filer UI)

Open <http://localhost:8888/buckets/browserhive/> and use the row-level
checkbox / delete control. Fine for spot work; impractical past a
handful of files.

### Wipe every artifact, keep the bucket (Filer HTTP API)

```sh
curl -X DELETE 'http://localhost:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true'
```

Recursively deletes every file under the bucket directory in one
request. The bucket itself stays, so the next `npm run server` works
without an init step. `ignoreRecursiveError=true` keeps the walk
going on per-file errors instead of aborting on the first one. The
Filer serves this on the same port (`8888`) as the browse UI.

### Reset the SeaweedFS state too (compose down -v)

```sh
docker compose -f compose.dev.yaml down -v
docker compose -f compose.dev.yaml up -d
```

Drops the `browserhive-seaweedfs-data` volume, taking the bucket and
all SeaweedFS metadata with it. The `seaweedfs-init` container
recreates the bucket on the next `up`. Reach for this when the
SeaweedFS state itself looks wrong (corrupt metadata, mismatched
credentials), not for routine artifact cleanup.
