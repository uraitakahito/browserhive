#!/bin/sh
# Bucket creation with bounded retries. Spawned in the background by
# entrypoint.sh alongside `weed server` — the retries below do all the
# waiting for the master to come up.
#
# `weed shell` reaches the master via gRPC, which can start accepting
# connections a moment after the HTTP endpoint. It then errors with
# "passthrough: received empty target" but still exits 0. We cannot rely
# on the command's exit code alone, so verify the end state by re-listing
# buckets after each attempt.
#
# Usage:  init-bucket.sh <bucket-name> [<master-host:port>]
set -eu

BUCKET="${1:?bucket name required}"
MASTER="${2:-localhost:9333}"
MAX_ATTEMPTS=30

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
