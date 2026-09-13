#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/ubuntu/games-calendar
REPO="$ROOT/repo"
WEB=/var/www/games-calendar
API="$REPO/games-api"
PM2_NAME=games-api

if [[ "$(id -un)" != "ubuntu" ]]; then
  echo "Run this script as the ubuntu user, not as root." >&2
  exit 1
fi

if [[ ! -d "$REPO/.git" ]]; then
  echo "Repository is missing at $REPO" >&2
  exit 1
fi

if [[ ! -d "$WEB" || ! -w "$WEB" ]]; then
  echo "Web root $WEB is missing or not writable by ubuntu. Run stremio-server-install.sh first." >&2
  exit 1
fi

mkdir -p "$API/data"

# Do not erase server fixes. Review and commit them before an update.
if [[ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]]; then
  echo "Update stopped: tracked files contain local changes. Review and commit them first." >&2
  exit 1
fi
if [[ "$(git -C "$REPO" branch --show-current)" != "main" ]]; then
  echo "Update stopped: expected the main branch." >&2
  exit 1
fi
git -C "$REPO" fetch origin main
git -C "$REPO" merge --ff-only origin/main

# Publish only browser-facing files. Do not expose .git, workflows, backend or build scripts.
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude 'games-api/' \
  --exclude 'node_modules/' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'fetch-games.js' \
  --exclude 'enrich-public-metadata.js' \
  --exclude 'enrich-steam-media.js' \
  --exclude '*.md' \
  "$REPO/" "$WEB/"

cd "$API"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
node scripts/ensure-vapid-keys.js .env

# Keep the API private on the VM; Nginx is the only public entry point.
if grep -q '^HOST=' .env; then
  sed -i 's/^HOST=.*/HOST=127.0.0.1/' .env
else
  printf '\nHOST=127.0.0.1\n' >> .env
fi
if grep -q '^PORT=' .env; then
  sed -i 's/^PORT=.*/PORT=8787/' .env
else
  printf 'PORT=8787\n' >> .env
fi
chmod 600 .env

npm run check

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start npm --name "$PM2_NAME" --cwd "$API" -- start
fi
pm2 save

for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8787/health >/dev/null; then
    echo "GameS API is healthy on 127.0.0.1:8787"
    echo "GameS web files are in $WEB"
    exit 0
  fi
  sleep 1
done

echo "GameS API did not become healthy. Last PM2 log:" >&2
pm2 logs "$PM2_NAME" --lines 60 --nostream >&2 || true
exit 1
