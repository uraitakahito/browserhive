---
title: Storage
description: The S3-compatible artifact store — bundled SeaweedFS, external S3, and addressing styles
---

Captured artifacts (PNG / WebP / HTML / links JSON / MHTML / WACZ) are uploaded
to an S3-compatible object store via `@aws-sdk/client-s3`. Anything that
speaks the S3 API works — self-hosted SeaweedFS (the bundled default),
AWS S3, Cloudflare R2, MinIO-compatible managed services.

## Bundled SeaweedFS

`bin/up.sh` ships with a self-hosted SeaweedFS service (Apache 2.0,
actively maintained) plus a one-shot `weed shell` init step that creates
the `browserhive` bucket on first start. Default S3 identity is
`browserhive` / `browserhive`, overridable via the
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY` env
vars when invoking `./bin/up.sh` (the bundled SeaweedFS and the
BrowserHive container read from the same pair, so they always agree by
construction).

Nothing is published to host ports: the S3 API (`:8333`) and the Filer UI
(`:8888`) listen on the SeaweedFS container's own IP, reachable from the
Mac only (open `http://<seaweedfs-ip>:8888/buckets/browserhive/` to
inspect captured artifacts; IP from `container ls`).

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
`BROWSERHIVE_S3_FORCE_PATH_STYLE=true`). `bin/up.sh` opts the bundled
SeaweedFS in to path-style via this env var automatically.

The `s3-access-key-id` and `s3-secret-access-key` values are accepted
on the command line for completeness, but prefer the
`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY`
env vars so the secret does not appear in `ps`.
