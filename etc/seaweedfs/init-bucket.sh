#!/bin/sh
# One-shot bucket creation against the bundled SeaweedFS, with bounded
# retries.
#
# `weed shell` reaches the master via gRPC on a port distinct from the
# HTTP healthcheck used by `compose.*.yaml`. The HTTP endpoint can be
# reachable a moment before the gRPC port accepts connections — `weed
# shell` then errors with "passthrough: received empty target" but
# still exits 0. We cannot rely on the command's exit code alone, so
# verify the end state by re-listing buckets after each attempt.
#
# Usage:  init-bucket.sh <bucket-name> [<master-host:port>]
set -eu

BUCKET="${1:?bucket name required}"
MASTER="${2:-seaweedfs:9333}"
MAX_ATTEMPTS=10

attempt=0
while [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; do
  attempt=$((attempt + 1))
  echo "s3.bucket.create -name ${BUCKET}" | weed shell -master="${MASTER}" 2>&1 || true
  if echo "s3.bucket.list" | weed shell -master="${MASTER}" 2>/dev/null \
      | awk '{print $1}' | grep -q "^${BUCKET}$"; then
    echo "Bucket ${BUCKET} ready."
    exit 0
  fi
  echo "attempt ${attempt}: bucket not yet created, retrying in 1s..."
  sleep 1
done

echo "ERROR: bucket ${BUCKET} could not be created after ${MAX_ATTEMPTS} attempts" >&2
exit 1
