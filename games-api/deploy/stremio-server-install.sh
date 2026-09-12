#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/ubuntu/games-calendar
REPO="$ROOT/repo"
WEB=/var/www/games-calendar
REPO_URL=https://github.com/CaseyCZ/GameS-Calendar-Website.git
NGINX_SITE=/etc/nginx/sites-available/default
NGINX_SNIPPET=/etc/nginx/snippets/games-calendar.conf
DASHBOARD=/home/ubuntu/stremio-dashboard/index.js

if [[ "$(id -un)" != "ubuntu" ]]; then
  echo "Run this script as the ubuntu user, not as root." >&2
  exit 1
fi

for cmd in node npm pm2 git curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command is missing: $cmd" >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js 22.13+ is required. Current: $(node -v)" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y rsync
fi

mkdir -p "$ROOT"
if [[ ! -d "$REPO/.git" ]]; then
  git clone "$REPO_URL" "$REPO"
else
  git -C "$REPO" fetch origin main
  git -C "$REPO" checkout main
  git -C "$REPO" reset --hard origin/main
fi

# Keep the browser files in a normal Nginx-readable location, while the repo/API stay in ubuntu's home.
sudo mkdir -p "$WEB"
sudo chown ubuntu:www-data "$WEB"
sudo chmod 0755 "$WEB"

bash "$REPO/games-api/deploy/stremio-server-update.sh"

# Add GameS routes without replacing any existing Stremio locations.
sudo install -m 0644 "$REPO/games-api/deploy/nginx-stremio-server.conf" "$NGINX_SNIPPET"

if ! sudo grep -Fq 'include /etc/nginx/snippets/games-calendar.conf;' "$NGINX_SITE"; then
  BACKUP="${NGINX_SITE}.backup-games-$(date +%Y%m%d-%H%M%S)"
  sudo cp "$NGINX_SITE" "$BACKUP"
  sudo python3 - "$NGINX_SITE" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
needle = '    location / {\n        return 404;\n    }'
include = '    include /etc/nginx/snippets/games-calendar.conf;\n\n'
if needle not in text:
    raise SystemExit('Cannot find the final Nginx 404 location; no changes were written.')
p.write_text(text.replace(needle, include + needle, 1))
PY
  echo "Nginx backup: $BACKUP"
fi

sudo nginx -t
sudo systemctl reload nginx

# Integrate GameS into the existing authenticated PM2 dashboard.
if [[ -f "$DASHBOARD" ]]; then
  node "$REPO/games-api/deploy/stremio-dashboard-patch.cjs" "$DASHBOARD"
  node --check "$DASHBOARD"
  pm2 restart stremio-dashboard --update-env
  pm2 save
else
  echo "Dashboard not found at $DASHBOARD; GameS itself is installed, dashboard patch skipped." >&2
fi

curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8787/health >/dev/null
curl --insecure --fail --silent --show-error --max-time 5 https://127.0.0.1:8443/games-health >/dev/null
curl --insecure --fail --silent --show-error --max-time 5 https://127.0.0.1:8443/games/ >/dev/null

echo
echo "GameS Calendar installed alongside the existing Stremio services."
echo "PM2 process: games-api (127.0.0.1:8787)"
echo "Web root:     $WEB"
echo "Web route:    https://SERVER:8443/games/"
echo "API route:    https://SERVER:8443/games-api/"
echo "Health route: https://SERVER:8443/games-health"
echo "Dashboard:    existing /dashboard/ now includes games-api"
