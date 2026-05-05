# Production Environment

`compose.prod.yaml` mirrors the dev stack — two Chromium servers, a
self-hosted SeaweedFS + bucket-init container, and the BrowserHive
production image — and supplies all required configuration via
`BROWSERHIVE_*` environment variables; no `command:` overrides are
needed. The bundled SeaweedFS is **not** published to host ports (only
`expose:`d on the internal network). Override `BROWSERHIVE_S3_ENDPOINT`
and the credential env vars to point at an external S3 (AWS, Cloudflare
R2, managed MinIO-compatible service) instead.

```sh
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml logs -f browserhive

# verify
curl http://localhost:8080/v1/status
```

Stop with:

```sh
docker compose -f compose.prod.yaml down
```

> **Note:** The SeaweedFS data volume (`browserhive-seaweedfs-prod-data`)
> holds every captured artifact. Plan its backup / lifecycle separately —
> `docker compose down -v` will wipe it. For external S3 deployments,
> the volume is unused.

To build the production image standalone (e.g. to push to a registry):

```sh
docker build -f Dockerfile.prod -t browserhive:<version> .
```

Standalone run, pointing at an external S3-compatible store:

```sh
docker run --rm -p 8080:8080 \
  -e BROWSERHIVE_BROWSER_URLS=http://chromium-server-1:9222 \
  -e BROWSERHIVE_S3_ENDPOINT=https://s3.example.com \
  -e BROWSERHIVE_S3_BUCKET=browserhive \
  -e BROWSERHIVE_S3_ACCESS_KEY_ID=... \
  -e BROWSERHIVE_S3_SECRET_ACCESS_KEY=... \
  browserhive:<version>
```
