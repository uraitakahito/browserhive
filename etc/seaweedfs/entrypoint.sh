#!/bin/sh
# Render the SeaweedFS S3 identity config from environment variables, then
# exec `weed server` with master + volume + filer + s3 in one process.
#
# The S3 identity here is the SAME one BrowserHive uses on the client side
# (BROWSERHIVE_S3_ACCESS_KEY_ID / BROWSERHIVE_S3_SECRET_ACCESS_KEY in the
# browserhive container). Both pull from the same docker-compose env so the
# bundled SeaweedFS and the client agree on credentials by construction.
#
# `s3.json` is written to a tmpfs-friendly path (/tmp) because the mounted
# /etc/seaweedfs directory is read-only in compose.
set -eu

: "${BROWSERHIVE_S3_ACCESS_KEY_ID:?BROWSERHIVE_S3_ACCESS_KEY_ID is required}"
: "${BROWSERHIVE_S3_SECRET_ACCESS_KEY:?BROWSERHIVE_S3_SECRET_ACCESS_KEY is required}"

S3_CONFIG=/tmp/seaweedfs-s3.json
sed \
  -e "s|__ACCESS_KEY__|${BROWSERHIVE_S3_ACCESS_KEY_ID}|" \
  -e "s|__SECRET_KEY__|${BROWSERHIVE_S3_SECRET_ACCESS_KEY}|" \
  /etc/seaweedfs/s3.template.json > "${S3_CONFIG}"

exec weed server \
  -dir=/data \
  -master.volumeSizeLimitMB=1024 \
  -filer \
  -s3 \
  -s3.config="${S3_CONFIG}"
