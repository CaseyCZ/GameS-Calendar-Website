#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-_}"
REPO_URL="${2:-https://github.com/CaseyCZ/GameS-Calendar-Website.git}"
ROOT=/opt/games-calendar
REPO="$ROOT/repo"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git nginx rsync

NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! id games >/dev/null 2>&1; then
  useradd --system --home "$ROOT" --shell /usr/sbin/nologin games
fi

mkdir -p "$ROOT" "$ROOT/web" "$ROOT/games-api/data"

if [[ ! -d "$REPO/.git" ]]; then
  git clone --depth=1 "$REPO_URL" "$REPO"
else
  git -C "$REPO" fetch origin main
  git -C "$REPO" reset --hard origin/main
fi

install -m 0644 "$REPO/games-api/deploy/games-api.service" /etc/systemd/system/games-api.service

NGINX_TMP="$(mktemp)"
sed "s/server_name games\.example\.com;/server_name ${DOMAIN};/" "$REPO/games-api/deploy/nginx.conf" > "$NGINX_TMP"
install -m 0644 "$NGINX_TMP" /etc/nginx/sites-available/games-calendar
rm -f "$NGINX_TMP"
ln -sfn /etc/nginx/sites-available/games-calendar /etc/nginx/sites-enabled/games-calendar
rm -f /etc/nginx/sites-enabled/default

chmod +x "$REPO/games-api/deploy/oracle-update.sh"
"$REPO/games-api/deploy/oracle-update.sh"

systemctl enable games-api nginx

cat <<EOF

GameS Calendar is installed.
Web root: $ROOT/web
API:      $ROOT/games-api
Domain:   $DOMAIN

Next:
1. Edit $ROOT/games-api/.env if needed.
2. Open TCP 80 and 443 in the Oracle Cloud VCN/security list.
3. Point DNS to this VM before enabling HTTPS.
4. For HTTPS install certbot and run:
   apt-get install -y certbot python3-certbot-nginx
   certbot --nginx -d YOUR_DOMAIN
EOF
