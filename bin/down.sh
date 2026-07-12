#!/bin/bash
#
# Stop the whole BrowserHive Apple Container stack. All containers run with
# --rm, so stop == delete. The S3 volume (seaweedfs-data) is preserved —
# captured artifacts survive `down.sh && up.sh`.
#
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=bin/lib.sh
source bin/lib.sh

container stop browserhive >/dev/null 2>&1 || true
WORKERS="$(list_workers)"
[ -n "${WORKERS}" ] && echo "${WORKERS}" | xargs container stop >/dev/null 2>&1
container stop browserhive-seaweedfs >/dev/null 2>&1 || true
echo "stack stopped (S3 volume seaweedfs-data preserved)"
