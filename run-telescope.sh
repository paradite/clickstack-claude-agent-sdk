#!/bin/bash

# Telescope - Web log viewer for ClickHouse
# Docs: https://docs.iamtelescope.net

TELESCOPE_DIR="$HOME/.telescope"
CONFIG_FILE="$TELESCOPE_DIR/config.yaml"
DB_FILE="$TELESCOPE_DIR/db.sqlite3"

# Create directory if it doesn't exist
mkdir -p "$TELESCOPE_DIR"

# Download config files if they don't exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Downloading config.yaml..."
  curl -fsSL -o "$CONFIG_FILE" \
    "https://raw.githubusercontent.com/iamtelescope/telescope/refs/heads/main/dev/config.yaml"
fi

if [ ! -f "$DB_FILE" ]; then
  echo "Downloading db.sqlite3..."
  curl -fsSL -o "$DB_FILE" \
    "https://raw.githubusercontent.com/iamtelescope/telescope/refs/heads/main/dev/db.sqlite3"
fi

echo "Starting Telescope on http://localhost:9898"
echo ""
echo "First time setup:"
echo "  1. Go to http://localhost:9898/setup to create superuser"
echo "  2. Add ClickHouse connection:"
echo "     - Host: host.docker.internal (or localhost if using --network host)"
echo "     - Port: 8123"
echo "     - User: api"
echo "     - Password: api"
echo ""

docker run \
  -e TELESCOPE_CONFIG_FILE="/config.yaml" \
  -v "$(realpath "$CONFIG_FILE"):/config.yaml" \
  -v "$(realpath "$DB_FILE"):/db.sqlite3" \
  -p 9898:9898 \
  ghcr.io/iamtelescope/telescope:latest
