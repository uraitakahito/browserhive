#!/bin/bash
#
# Bring up the full BrowserHive stack on Apple Container (replaces the
# former docker compose files):
#
#   browserhive-seaweedfs  S3-compatible artifact store (+ one-shot bucket init)
#   chromium-1..N          headless Chromium workers (submodule bin/prod.sh)
#   browserhive            the capture server, wired to the above by IP
#
#   ./bin/up.sh        # 2 workers (default)
#   ./bin/up.sh 4      # 4 workers
#
# Only browserhive publishes a port (127.0.0.1:8080). Workers and S3 are
# reached over their per-VM IPs (192.168.64.0/24) — the compose service-name
# DNS is replaced by collecting IPs at startup and baking them into env.
# Restarting the stack is always `./bin/down.sh && ./bin/up.sh` (IPs change
# across restarts; partial restarts are unsupported by design).
#
# Can be invoked from any directory: the script cd's to the repository root.
#
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=bin/lib.sh
source bin/lib.sh

WORKERS="${1:-2}"
BUCKET="${BROWSERHIVE_S3_BUCKET:-browserhive}"
S3_KEY="${BROWSERHIVE_S3_ACCESS_KEY_ID:-browserhive}"
S3_SECRET="${BROWSERHIVE_S3_SECRET_ACCESS_KEY:-browserhive}"
SEAWEEDFS_IMAGE="docker.io/chrislusf/seaweedfs:4.23"

echo "== [1/5] meadow (fixture-origin for E2E) =="
container build -t meadow:latest ./meadow >/dev/null
container stop meadow >/dev/null 2>&1 || true
container run -d --rm --name meadow meadow:latest >/dev/null
MEADOW_IP="$(ip_of meadow)"
wait_http "http://${MEADOW_IP}:8080/health"
echo "meadow    : http://${MEADOW_IP}:8080"

echo "== [2/5] SeaweedFS (S3) =="
container volume create seaweedfs-data >/dev/null 2>&1 || true
container stop browserhive-seaweedfs >/dev/null 2>&1 || true
# The entrypoint renders the S3 identity from these env vars — the same
# credentials the browserhive container gets below, so client and store
# agree by construction.
container run -d --rm --name browserhive-seaweedfs \
    -e BROWSERHIVE_S3_ACCESS_KEY_ID="${S3_KEY}" \
    -e BROWSERHIVE_S3_SECRET_ACCESS_KEY="${S3_SECRET}" \
    -v "${PWD}/etc/seaweedfs:/etc/seaweedfs:ro" \
    -v seaweedfs-data:/data \
    --entrypoint /etc/seaweedfs/entrypoint.sh "${SEAWEEDFS_IMAGE}" >/dev/null
sleep 3
SW_IP="$(ip_of browserhive-seaweedfs)"
wait_http "http://${SW_IP}:9333/cluster/status"
container run --rm -v "${PWD}/etc/seaweedfs:/etc/seaweedfs:ro" \
    --entrypoint /etc/seaweedfs/init-bucket.sh "${SEAWEEDFS_IMAGE}" \
    "${BUCKET}" "${SW_IP}:9333" >/dev/null
echo "seaweedfs : http://${SW_IP}:8333 (bucket: ${BUCKET})"

echo "== [3/5] Chromium workers (${WORKERS}) =="
# Sweep stale workers first so a previous larger pool cannot leak extra
# entries into the URL list below; prod.sh then (re)creates chromium-1..N.
STALE="$(list_workers)"
[ -n "${STALE}" ] && echo "${STALE}" | xargs container stop >/dev/null 2>&1
./chromium-server-docker/bin/prod.sh "${WORKERS}" >/dev/null
echo "workers   : ${WORKERS} started"

echo "== [4/5] Worker URL wiring =="
URLS=""
while IFS= read -r name; do
    URLS="${URLS:+${URLS},}http://$(ip_of "${name}"):9222"
done < <(list_workers)
[ -n "${URLS}" ] || { echo "error: no chromium-* workers running" >&2; exit 1; }
echo "browser urls: ${URLS}"

echo "== [5/5] BrowserHive =="
container build -f Dockerfile.prod -t browserhive:prod .
container stop browserhive >/dev/null 2>&1 || true
container run -d --rm --name browserhive -p 127.0.0.1:8080:8080 \
    -e BROWSERHIVE_BROWSER_URLS="${URLS}" \
    -e BROWSERHIVE_S3_ENDPOINT="http://${SW_IP}:8333" \
    -e BROWSERHIVE_S3_REGION="${BROWSERHIVE_S3_REGION:-us-east-1}" \
    -e BROWSERHIVE_S3_BUCKET="${BUCKET}" \
    -e BROWSERHIVE_S3_ACCESS_KEY_ID="${S3_KEY}" \
    -e BROWSERHIVE_S3_SECRET_ACCESS_KEY="${S3_SECRET}" \
    -e BROWSERHIVE_S3_FORCE_PATH_STYLE=true \
    -e LOG_LEVEL="${LOG_LEVEL:-info}" \
    browserhive:prod >/dev/null
wait_http "http://localhost:8080/v1/status" 45

# Write the endpoints the E2E suite reads. globalSetup consumes this file
# instead of environment variables; IPs change across restarts so it is
# regenerated every up.sh. Listed in .gitignore.
cat > .e2e-stack.json <<EOF
{ "api": "http://localhost:8080", "meadow": "http://${MEADOW_IP}:8080" }
EOF

echo
echo "BrowserHive: http://localhost:8080"
echo "meadow     : http://${MEADOW_IP}:8080"
echo "Stop with  : ./bin/down.sh   Status: ./bin/status.sh"
