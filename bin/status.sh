#!/bin/bash
#
# Probe every component of the BrowserHive Apple Container stack from the
# outside (Apple Container does not evaluate HEALTHCHECK, so this external
# probe IS the health check).
#
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=bin/lib.sh
source bin/lib.sh

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
