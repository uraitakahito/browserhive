---
title: Storage
description: The S3-compatible artifact store — bundled SeaweedFS, external S3, and addressing styles
---

Captured artifacts (PNG / WebP / HTML / links JSON / MHTML / WACZ) are uploaded
to an S3-compatible object store via `@aws-sdk/client-s3`. Anything that
speaks the S3 API works — self-hosted SeaweedFS (the bundled default),
AWS S3, Cloudflare R2, MinIO-compatible managed services.

## Bundled SeaweedFS

The compose stack (`docker-compose.yml`) ships with a self-hosted
SeaweedFS service (Apache 2.0, actively maintained); its entrypoint
creates the `browserhive` bucket on first start with a bounded retry loop.
Default S3 identity is `browserhive` / `browserhive`, set by the
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY` env
entries in `docker-compose.yml` (the SeaweedFS and BrowserHive services
carry the same pair, so they always agree by construction).

Nothing is published to host ports: the S3 API (`:8333`) and the Filer UI
(`:8888`) listen on the SeaweedFS container, reachable from this Mac only
through its platform DNS name — open
`http://seaweedfs.browserhive:8888/buckets/browserhive/` to inspect
captured artifacts.

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
`BROWSERHIVE_S3_FORCE_PATH_STYLE=true`). `docker-compose.yml` opts the
bundled SeaweedFS in to path-style via this env var.

The `s3-access-key-id` and `s3-secret-access-key` values are accepted
on the command line for completeness, but prefer the
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY`
env vars so the secret does not appear in `ps`.
