#!/bin/bash
set -e

echo "Starting BrowserHive setup..."

# Download required files
BASE_URL="https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/tags/1.2.0"

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
CHROMIUM_SERVER_TAG="0.1.0"
if [ -d "chromium-server-docker" ]; then
  echo "Removing existing chromium-server-docker..."
  rm -rf chromium-server-docker
fi
echo "Cloning chromium-server-docker at tag ${CHROMIUM_SERVER_TAG}..."
git -c advice.detachedHead=false clone --depth 1 --branch "${CHROMIUM_SERVER_TAG}" https://github.com/uraitakahito/chromium-server-docker.git

# Generate .env file (always regenerated to reflect current host state)
GH_TOKEN=""
if command -v gh &> /dev/null; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
fi
if [ -z "$GH_TOKEN" ]; then
  echo "WARNING: gh CLI not found or not authenticated. GH_TOKEN will be empty." >&2
  echo "  Install gh: https://cli.github.com/" >&2
  echo "  Then run: gh auth login" >&2
fi

cat > .env << EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=Asia/Tokyo
GH_TOKEN=${GH_TOKEN}
EOF
echo "Created .env file"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  docker compose up -d"
