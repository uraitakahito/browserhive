#!/bin/bash
set -e

# Configuration
BASE_URL="https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/tags/1.2.7"
CHROMIUM_SERVER_TAG="0.2.0"

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

# Clone chromium-server-docker at pinned tag
if [ -d "chromium-server-docker" ]; then
  echo "Removing existing chromium-server-docker..."
  rm -rf chromium-server-docker
fi
echo "Cloning chromium-server-docker at tag ${CHROMIUM_SERVER_TAG}..."
git -c advice.detachedHead=false clone --depth 1 --branch "${CHROMIUM_SERVER_TAG}" https://github.com/uraitakahito/chromium-server-docker.git

# Generate .env file (always regenerated to reflect current host state).
# GH_TOKEN is intentionally NOT persisted here — it is injected from the
# host's `gh` CLI at compose-time. See README "Development Environment".
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
