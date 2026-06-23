#!/usr/bin/env bash
#
# One-shot Lightsail bootstrap for CS2 Manager.
# Works on any Debian-family Lightsail blueprint (Ubuntu → user `ubuntu`,
# Debian → user `admin`). The runtime user is auto-detected from $SUDO_USER.
#
# Usage:
#   ssh <user>@<lightsail-ip>
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/<you>/csmanager/main/deploy/install.sh)" -- csm.yourdomain.com https://github.com/<you>/csmanager.git
#
# Or after cloning manually:
#   sudo bash deploy/install.sh csm.yourdomain.com
#
# What it does:
#   1. Stops + disables any pre-existing webserver on :80 (Apache / nginx)
#   2. Installs Node 20, git, build tools, Caddy
#   3. Clones the repo to ~/csmanager (skips if it exists)
#   4. Installs server deps + builds the React client
#   5. Templates + installs the systemd unit + Caddy config with the
#      supplied domain and the detected runtime user
#   6. Enables both services
#
# What you do yourself:
#   - Point an A record (csm.yourdomain.com) at the Lightsail static IP
#   - Open ports 80 + 443 in the Lightsail firewall

set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain> [repo-url]"
  echo "Example: $0 csm.yourdomain.com https://github.com/you/csmanager.git"
  exit 1
fi

# ---- Detect the human user this script should chown for / run as ----
# Priority: $SUDO_USER (the invoker) > the first non-root login user on the box.
RUN_USER="${SUDO_USER:-}"
if [[ -z "$RUN_USER" || "$RUN_USER" == "root" ]]; then
  RUN_USER=$(getent passwd 1000 2>/dev/null | cut -d: -f1)
fi
if [[ -z "$RUN_USER" ]]; then
  echo "Could not detect a non-root user. Re-run as: sudo bash deploy/install.sh ..."
  exit 1
fi
HOME_DIR=$(getent passwd "$RUN_USER" | cut -d: -f6)
REPO_DIR="$HOME_DIR/csmanager"
echo "==> Runtime user: $RUN_USER ($HOME_DIR)"

SUDO=""
if [[ $EUID -ne 0 ]]; then SUDO="sudo"; fi

# ---- Free up port 80 if Apache or nginx are squatting it ----
echo "==> Checking port 80"
for svc in apache2 nginx httpd; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\\.service"; then
    if systemctl is-enabled "$svc" >/dev/null 2>&1 || systemctl is-active "$svc" >/dev/null 2>&1; then
      echo "    Stopping pre-existing $svc"
      $SUDO systemctl disable --now "$svc" || true
    fi
  fi
done

# ---- Install Node 20, git, Caddy ----
echo "==> Installing Node.js 20, git, build tools, Caddy"
$SUDO apt-get update
$SUDO apt-get install -y curl git build-essential debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
$SUDO apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
$SUDO apt-get update
$SUDO apt-get install -y caddy

# Helper: run a command as the runtime user. Always uses `sudo -u` directly
# (not via $SUDO) because dropping privileges from root still requires sudo.
as_user() { sudo -u "$RUN_USER" "$@"; }

# ---- Repo on disk ----
echo "==> Repo location: $REPO_DIR"
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "    Already cloned — pulling latest"
  as_user git -C "$REPO_DIR" pull --ff-only
elif [[ -n "$REPO_URL" ]]; then
  echo "    Cloning $REPO_URL"
  as_user git clone "$REPO_URL" "$REPO_DIR"
else
  echo "    No clone present and no repo URL supplied — copy the project to $REPO_DIR manually, then rerun."
  exit 1
fi
$SUDO chown -R "$RUN_USER:$RUN_USER" "$REPO_DIR"

# ---- Server deps + client build (as the runtime user, not root) ----
echo "==> Installing server deps + building client"
as_user bash -c "cd $REPO_DIR/server && npm install"
as_user bash -c "cd $REPO_DIR && npm install && npm run build"
as_user mkdir -p "$REPO_DIR/server/data"

# ---- Templated systemd unit ----
echo "==> Installing systemd unit for $RUN_USER"
$SUDO tee /etc/systemd/system/csm-server.service > /dev/null <<EOF
[Unit]
Description=CS2 Manager multiplayer server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$REPO_DIR/server
Environment=CSM_PORT=8787
Environment=CSM_BIND=127.0.0.1
Environment=CSM_DB=$REPO_DIR/server/data/csm.db
# Admin powers (optional): set this to the IN-GAME nickname you'll log in with.
# Whoever connects with that nickname (case-insensitive) sees the Admin button
# on the home screen — list users, reset PINs, edit teams, force-delete teams.
# Leave blank or unset to disable admin entirely.
Environment=CSM_ADMIN_NICK=
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now csm-server

# ---- Templated Caddyfile ----
echo "==> Installing Caddyfile for $DOMAIN (root: $REPO_DIR/dist)"
$SUDO bash -c "sed -e 's|csm.yourdomain.com|$DOMAIN|g' -e 's|/home/ubuntu/csmanager|$REPO_DIR|g' $REPO_DIR/deploy/Caddyfile > /etc/caddy/Caddyfile"
$SUDO systemctl reload caddy || $SUDO systemctl restart caddy

echo
echo "==> Done."
echo "    Server:    sudo systemctl status csm-server"
echo "    Server log: sudo journalctl -fu csm-server"
echo "    Caddy:     sudo systemctl status caddy"
echo "    Caddy log:  sudo journalctl -fu caddy"
echo
echo "    Once DNS for $DOMAIN points at this box AND ports 80/443 are open,"
echo "    visit https://$DOMAIN — your client will load and connect to wss://$DOMAIN automatically."
