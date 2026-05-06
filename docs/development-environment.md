# Development Environment

```sh
GH_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up -d
```

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

Open these URLs from the host browser to watch the running Chromium:

| Server | noVNC (browser) | Raw VNC |
|--------|-----------------|---------|
| chromium-server-1 | http://localhost:6080/ | `localhost:5901` |
| chromium-server-2 | http://localhost:6081/ | `localhost:5902` |

## Browsing captured artifacts in SeaweedFS

The bundled SeaweedFS exposes its **Filer UI** at
<http://localhost:8888/buckets/browserhive/>.

From inside the SeaweedFS container, you can also list them via:

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
curl -X DELETE 'http://localhost:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true' && \
  curl -X PUT  'http://localhost:8888/buckets/browserhive/.keep' --data '' && \
  curl -X DELETE 'http://localhost:8888/buckets/browserhive/.keep'
```

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
