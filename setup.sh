#!/bin/bash
set -e

echo "Starting BrowserHive setup..."

# Download required files
echo "Downloading Dockerfile..."
curl -L -O https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/heads/main/Dockerfile

echo "Downloading docker-entrypoint.sh..."
curl -L -O https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/heads/main/docker-entrypoint.sh
chmod 755 docker-entrypoint.sh

# Clone chromium-server-docker (if not exists)
if [ ! -d "chromium-server-docker" ]; then
  echo "Cloning chromium-server-docker..."
  git clone --depth 1 https://github.com/uraitakahito/chromium-server-docker.git
else
  echo "chromium-server-docker already exists. Skipping."
fi

# Create .env file (if not exists)
if [ ! -f .env ]; then
  cat > .env << EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=Asia/Tokyo
EOF
  echo "Created .env file"
else
  echo ".env file already exists. Skipping."
fi

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  docker compose up -d"
