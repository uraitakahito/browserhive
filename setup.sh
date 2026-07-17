#!/bin/bash
set -e

echo "Starting BrowserHive setup..."

echo "Initializing submodules (chromium-server-docker, meadow)..."
git submodule update --init chromium-server-docker meadow

echo "Building meadow (fixture-origin) so \"meadow\": \"file:./meadow\" resolves its dist/..."
npm --prefix meadow ci
npm --prefix meadow run build

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  ./bin/up.sh 2        # start the full stack on Apple Container"
echo "  ./bin/status.sh      # probe every component"
echo "  npm ci               # only if developing the server on the host"
