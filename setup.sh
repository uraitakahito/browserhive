#!/bin/bash
set -e

echo "Starting BrowserHive setup..."

echo "Initializing chromium-server-docker submodule..."
git submodule update --init chromium-server-docker

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  ./bin/up.sh 2        # start the full stack on Apple Container"
echo "  ./bin/status.sh      # probe every component"
echo "  npm ci               # only if developing the server on the host"
