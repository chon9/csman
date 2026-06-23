#!/usr/bin/env bash
#
# Pull the latest, rebuild the client, restart the server. Run on the
# Lightsail box whenever you push new commits.
#
# Usage: bash deploy/update.sh

set -euo pipefail
REPO_DIR="${REPO_DIR:-/home/ubuntu/csmanager}"

cd "$REPO_DIR"
git pull --ff-only

# Server deps + client build run as the unprivileged user.
( cd server && npm install --omit=dev || npm install )
npm install
npm run build

sudo systemctl restart csm-server
sudo systemctl reload caddy
echo "==> Updated. Tail with: sudo journalctl -fu csm-server"
