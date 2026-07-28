---
title: Storage
description: The S3-compatible artifact store — bundled SeaweedFS, wiping artifacts, external S3, and addressing styles
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

## Wiping captured artifacts

How to clear artifacts from the bundled SeaweedFS. There are none to start
with, so reach for this only when you actually need to clean up.

### Wipe every artifact, keep the bucket (Filer HTTP API)

```sh
SW=seaweedfs.browserhive
curl -X DELETE "http://${SW}:8888/buckets/browserhive/?recursive=true&ignoreRecursiveError=true" && \
  curl -X PUT  "http://${SW}:8888/buckets/browserhive/.keep" --data '' && \
  curl -X DELETE "http://${SW}:8888/buckets/browserhive/.keep"
```

### Reset the SeaweedFS state too

```sh
container-compose down
container volume rm browserhive_seaweedfs-data
container-compose up -d
```

Drops the `browserhive_seaweedfs-data` volume, taking the bucket and all
SeaweedFS metadata with it; the next `up` recreates the volume, and the
seaweedfs entrypoint recreates the bucket.
Reach for this when the SeaweedFS state itself looks wrong (corrupt
metadata, mismatched credentials), not for routine artifact cleanup.

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

### What the region is actually for

`BROWSERHIVE_S3_REGION` does not choose where to connect —
`BROWSERHIVE_S3_ENDPOINT` does. The region is one field of the SigV4
credential scope that every signed request carries:

```
Credential=browserhive/20260728/us-east-1/s3/aws4_request
            └ access key ┘ └ date ┘ └ region ┘ └ service ┘
```

**The bundled SeaweedFS does not check the value.** Signing with
`moon-base-1` succeeds and lists the bucket exactly the same way. The
`us-east-1` default is a placeholder, not a location.

It still cannot be left out. The signer needs *some* region, and
clients disagree about what happens when it is missing: the AWS CLI
quietly falls back to `us-east-1`, while the AWS SDK for JavaScript —
which [waxlens](https://github.com/uraitakahito/waxlens) uses to read
these same objects — fails with `Region is missing`. Setting it
explicitly makes both behave.

:::caution[It may be coming from `~/.aws/config`]
The SDK also reads `region` from `~/.aws/config`, so a machine with a
profile configured works even when nothing sets the variable. The break
shows up later, on a machine without that file — a CI runner or a
container. Set it explicitly rather than relying on the ambient profile.
:::

Against real AWS the region stops being a placeholder: it has to match
the bucket's region, and without an endpoint override it also selects
the host (`s3.<region>.amazonaws.com`). "Any string works" is only true
while an endpoint is pinned at an S3-compatible store.
