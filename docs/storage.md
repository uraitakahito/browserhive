# Storage

Captured artifacts (PNG / WebP / HTML / links JSON / PDF / MHTML / WACZ) are uploaded
to an S3-compatible object store via `@aws-sdk/client-s3`. Anything that
speaks the S3 API works — self-hosted SeaweedFS (the bundled default),
AWS S3, Cloudflare R2, MinIO-compatible managed services.

## Bundled SeaweedFS

Both `compose.dev.yaml` and `compose.prod.yaml` ship with a self-hosted
SeaweedFS service (Apache 2.0, actively maintained) plus a one-shot
`weed shell` init container that creates the `browserhive` bucket on
first start. Default S3 identity is `browserhive` / `browserhive`,
overridable via the `BROWSERHIVE_S3_ACCESS_KEY_ID` /
`BROWSERHIVE_S3_SECRET_ACCESS_KEY` env vars on `docker compose up`
(the bundled SeaweedFS and the BrowserHive container read from the
same pair, so they always agree by construction).

The dev compose publishes the SeaweedFS S3 API at `localhost:8333`
and the Filer UI at `localhost:8888` (open
<http://localhost:8888/buckets/browserhive/> to inspect captured
artifacts). The prod compose `expose:`s them only to the internal
network.

## External S3

To point at an external store (AWS / R2 / managed MinIO-compatible
service) instead, set the `BROWSERHIVE_S3_*` env vars on the
BrowserHive container:

```yaml
environment:
  - BROWSERHIVE_S3_ENDPOINT=https://s3.example.com
  - BROWSERHIVE_S3_BUCKET=browserhive-prod
  - BROWSERHIVE_S3_REGION=us-east-1
  - BROWSERHIVE_S3_ACCESS_KEY_ID=...
  - BROWSERHIVE_S3_SECRET_ACCESS_KEY=...
```

The default is virtual-hosted-style addressing — the form AWS S3
expects. For SeaweedFS, MinIO-compatible managed services, and most
other self-hosted S3 implementations (which do not have wildcard DNS
for the bucket subdomain), pass `--s3-force-path-style` (or set
`BROWSERHIVE_S3_FORCE_PATH_STYLE=true`). The bundled SeaweedFS in
`compose.dev.yaml` / `compose.prod.yaml` opts in to path-style via
this env var automatically.

The `s3-access-key-id` and `s3-secret-access-key` values are accepted
on the command line for completeness, but prefer the
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY`
env vars so the secret does not appear in `ps`.
