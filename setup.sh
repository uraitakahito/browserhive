#!/bin/bash
set -e

HELLO_JAVASCRIPT_VERSION="1.2.9"
BASE_URL="https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/tags/${HELLO_JAVASCRIPT_VERSION}"

echo "Starting BrowserHive setup..."

echo "Downloading Dockerfile.dev..."
if ! curl -fL -O "${BASE_URL}/Dockerfile.dev"; then
  echo "ERROR: Failed to download Dockerfile.dev from:" >&2
  echo "  ${BASE_URL}/Dockerfile.dev" >&2
  echo "Please check if the URL is accessible." >&2
  exit 1
fi

echo "Downloading docker-entrypoint.sh..."
if ! curl -fL -O "${BASE_URL}/docker-entrypoint.sh"; then
  echo "ERROR: Failed to download docker-entrypoint.sh from:" >&2
  echo "  ${BASE_URL}/docker-entrypoint.sh" >&2
  echo "Please check if the URL is accessible." >&2
  exit 1
fi
chmod 755 docker-entrypoint.sh

echo "Initializing chromium-server-docker submodule..."
git submodule update --init chromium-server-docker

cat > .env << EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=Asia/Tokyo
EOF
echo "Created .env file"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  GH_TOKEN=\$(gh auth token) docker compose -f compose.dev.yaml up -d"
