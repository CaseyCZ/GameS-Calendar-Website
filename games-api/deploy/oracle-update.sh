#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/games-calendar
REPO="$ROOT/repo"
WEB="$ROOT/web"
API="$ROOT/games-api"
SERVICE=games-api

if [[ ! -d "$REPO/.git" ]]; then
  echo "Repository is missing at $REPO" >&2
  exit 1
fi

mkdir -p "$WEB" "$API" "$API/data"

# Publish only browser-facing files. Keep backend/build/admin files out of the web root.
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

# Deploy API code while preserving runtime state and secrets.
rsync -a --delete \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude 'node_modules/' \
  "$REPO/games-api/" "$API/"

cd "$API"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created $API/.env from .env.example"
fi

chown -R games:games "$API"
chmod 750 "$API"
chmod 640 "$API/.env" || true

systemctl daemon-reload
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"
nginx -t
systemctl reload nginx

curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8787/health >/dev/null

echo "GameS web + API deployment completed successfully."
