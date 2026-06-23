#!/usr/bin/env bash
#
# One-shot Lightsail bootstrap for CS2 Manager.
# Run on a fresh Ubuntu 22.04 / 24.04 instance as the `ubuntu` user.
#
# Usage:
#   ssh ubuntu@<lightsail-ip>
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/<you>/csmanager/main/deploy/install.sh)" -- csm.yourdomain.com https://github.com/<you>/csmanager.git
#
# Or after cloning manually:
#   bash deploy/install.sh csm.yourdomain.com
#
# What it does:
#   1. Installs Node 20, git, Caddy
#   2. Clones the repo to /home/ubuntu/csmanager (skips if it exists)
#   3. Installs server deps + builds the React client
#   4. Drops in the systemd unit + Caddy config with the supplied domain
#   5. Enables both services + tails the server log
#
# What you do yourself:
#   - Point an A record (csm.yourdomain.com) at the Lightsail static IP
#   - Open ports 80 + 443 in the Lightsail firewall (the only public ports)

set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain> [repo-url]"
  echo "Example: $0 csm.yourdomain.com https://github.com/you/csmanager.git"
  exit 1
fi

SUDO=""
if [[ $EUID -ne 0 ]]; then SUDO="sudo"; fi

echo "==> Installing Node.js 20, git, build tools, Caddy"
$SUDO apt-get update
$SUDO apt-get install -y curl git build-essential debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
$SUDO apt-get install -y nodejs
# Caddy official repo
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
$SUDO apt-get update
$SUDO apt-get install -y caddy

echo "==> Repo location"
REPO_DIR="/home/ubuntu/csmanager"
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "    Already cloned at $REPO_DIR — pulling latest"
  git -C "$REPO_DIR" pull --ff-only
elif [[ -n "$REPO_URL" ]]; then
  echo "    Cloning $REPO_URL into $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
else
  echo "    No clone present and no repo URL supplied — copy the project to $REPO_DIR manually, then rerun this script."
  exit 1
fi
chown -R ubuntu:ubuntu "$REPO_DIR"

echo "==> Installing server deps + building client"
sudo -u ubuntu bash -c "cd $REPO_DIR/server && npm install"
sudo -u ubuntu bash -c "cd $REPO_DIR && npm install && npm run build"
sudo -u ubuntu mkdir -p "$REPO_DIR/server/data"

echo "==> Installing systemd unit"
$SUDO cp "$REPO_DIR/deploy/csm-server.service" /etc/systemd/system/csm-server.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now csm-server

echo "==> Installing Caddyfile with domain=$DOMAIN"
$SUDO sed "s/csm.yourdomain.com/$DOMAIN/g" "$REPO_DIR/deploy/Caddyfile" > /tmp/Caddyfile
$SUDO mv /tmp/Caddyfile /etc/caddy/Caddyfile
$SUDO systemctl reload caddy

echo
echo "==> Done."
echo "    Server:   sudo systemctl status csm-server"
echo "    Server log: sudo journalctl -fu csm-server"
echo "    Caddy:    sudo systemctl status caddy"
echo "    Caddy log:  sudo journalctl -fu caddy"
echo
echo "    Once DNS for $DOMAIN points at this box AND ports 80/443 are open,"
echo "    visit https://$DOMAIN — your client will load and connect to wss://$DOMAIN automatically."
