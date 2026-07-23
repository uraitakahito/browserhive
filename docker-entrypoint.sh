#!/bin/sh
# Wait (bounded) for the S3 endpoint before starting the server, when asked.
#
# The startup HeadBucket validation is deliberately fatal (bad storage
# config should fail fast), and container-compose provides no readiness
# ordering — `depends_on` is start order only. Under the compose stack the
# consumer therefore waits for itself: docker-compose.yml sets WAIT_FOR_S3
# and this shim polls until the S3 listener answers HTTP (any status —
# ECONNREFUSED means "not yet"). Standalone `container run` without the
# env var starts the server immediately, exactly as before.
set -eu

if [ -n "${WAIT_FOR_S3:-}" ]; then
    i=0
    until node -e "fetch(process.env.WAIT_FOR_S3).then(() => process.exit(0), () => process.exit(1))" 2>/dev/null; do
        i=$((i + 1))
        if [ "$i" -ge 120 ]; then
            echo "error: S3 never answered at ${WAIT_FOR_S3}" >&2
            exit 1
        fi
        sleep 0.5
    done
fi

exec node dist/bin/main.js
