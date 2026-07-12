#!/bin/bash
#
# Shared helpers for the Apple Container stack scripts (up.sh / down.sh /
# status.sh). Not executable on its own — source it.
#
# Requires only tools present on a stock macOS + Apple Container install:
# bash, container, python3, curl.

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
