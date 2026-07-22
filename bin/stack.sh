#!/bin/bash
#
# stack.sh — one entry point for the BrowserHive Apple Container stack
# (replaces the former up.sh / down.sh / status.sh trio and their lib.sh):
#
#   ./bin/stack.sh up [N]    build + start S3, N chromium workers (default 2), browserhive
#   ./bin/stack.sh down      stop everything (S3 volume seaweedfs-data is preserved)
#   ./bin/stack.sh status    probe every component from the outside
#
# The stack (replaces the former docker compose files):
#
#   browserhive-seaweedfs  S3-compatible artifact store (+ one-shot bucket init)
#   chromium-1..N          headless Chromium workers (submodule bin/prod.sh)
#   browserhive            the capture server, wired to the above by IP
#
# Only browserhive publishes a port (127.0.0.1:8080). Workers and S3 are
# reached over their per-VM IPs (192.168.64.0/24) — the compose service-name
# DNS is replaced by collecting IPs at startup and baking them into env.
# Restarting the stack is always `./bin/stack.sh down && ./bin/stack.sh up`
# (IPs change across restarts; partial restarts are unsupported by design).
#
# Requires only tools present on a stock macOS + Apple Container install:
# bash, container, python3, curl.
#
# Can be invoked from any directory: the script cd's to the repository root.
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- helpers --

# Print the IPv4 address of a running container.
ip_of() {
    container inspect "$1" | python3 -c 'import json, sys
d = json.load(sys.stdin); d = d[0] if isinstance(d, list) else d
print(d["status"]["networks"][0]["ipv4Address"].split("/")[0])'
}

# List the names of running chromium-* workers, one per line, sorted.
list_workers() {
    container ls --format json | python3 -c 'import json, sys
ids = sorted(c.get("configuration", {}).get("id", "") for c in json.load(sys.stdin))
print("\n".join(i for i in ids if i.startswith("chromium-")))'
}

# Wait until an HTTP URL answers 2xx, with a bounded number of 1s retries.
# (Replaces compose healthcheck / depends_on: Apple Container does not
# evaluate HEALTHCHECK, so readiness is probed externally.)
wait_http() {
    local url="$1" attempts="${2:-30}" i=0
    until curl -sf --max-time 3 "$url" >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge "$attempts" ]; then
            echo "error: timed out waiting for ${url}" >&2
            return 1
        fi
        sleep 1
    done
}

usage() {
    cat >&2 <<'EOF'
Usage: ./bin/stack.sh <command>

  up [N]    build and start the stack with N chromium workers (default 2)
  down      stop the whole stack (S3 volume seaweedfs-data is preserved)
  status    probe every component from the outside
EOF
}

# --------------------------------------------------------------------- up --

cmd_up() {
    [ -f chromium-server-docker/bin/prod.sh ] && [ -f meadow/Dockerfile ] || {
        echo "error: submodules not initialized — run: git submodule update --init" >&2
        exit 1
    }

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
    # regenerated on every `stack.sh up`. Listed in .gitignore.
    cat > .e2e-stack.json <<EOF
{ "api": "http://localhost:8080", "meadow": "http://${MEADOW_IP}:8080" }
EOF

    echo
    echo "BrowserHive: http://localhost:8080"
    echo "meadow     : http://${MEADOW_IP}:8080"
    echo "Stop with  : ./bin/stack.sh down   Status: ./bin/stack.sh status"
}

# ------------------------------------------------------------------- down --

# All containers run with --rm, so stop == delete. The S3 volume
# (seaweedfs-data) is preserved — captured artifacts survive
# `stack.sh down && stack.sh up`.
cmd_down() {
    container stop browserhive >/dev/null 2>&1 || true
    container stop meadow >/dev/null 2>&1 || true
    WORKERS="$(list_workers)"
    [ -n "${WORKERS}" ] && echo "${WORKERS}" | xargs container stop >/dev/null 2>&1
    container stop browserhive-seaweedfs >/dev/null 2>&1 || true
    echo "stack stopped (S3 volume seaweedfs-data preserved)"
}

# ----------------------------------------------------------------- status --

# Probe every component from the outside (Apple Container does not evaluate
# HEALTHCHECK, so this external probe IS the health check).
cmd_status() {
    probe() { # name, url
        if curl -sf --max-time 5 "$2" >/dev/null 2>&1; then
            printf 'OK   %-24s %s\n' "$1" "$2"
        else
            printf 'NG   %-24s %s\n' "$1" "$2"
        fi
    }

    if SW_IP="$(ip_of browserhive-seaweedfs 2>/dev/null)"; then
        probe "seaweedfs (S3)" "http://${SW_IP}:9333/cluster/status"
    else
        echo "NG   seaweedfs (S3)          not running"
    fi

    FOUND=0
    while IFS= read -r name; do
        [ -n "${name}" ] || continue
        FOUND=1
        probe "${name}" "http://$(ip_of "${name}"):9222/json/version"
    done < <(list_workers)
    [ "${FOUND}" -eq 1 ] || echo "NG   chromium workers        none running"

    probe "browserhive" "http://localhost:8080/v1/status"
}

# --------------------------------------------------------------- dispatch --

case "${1:-}" in
    up)             shift; cmd_up "$@" ;;
    down)           cmd_down ;;
    status)         cmd_status ;;
    -h|--help|help) usage; exit 0 ;;
    "")             usage; exit 1 ;;
    *)              echo "error: unknown command: $1" >&2; usage; exit 1 ;;
esac
