# GameS Calendar on the current Oracle Stremio server

This deployment is tailored to the existing host discovered on 2026-09-12:

- Node.js 24
- PM2 managed by the `ubuntu` user
- existing processes on ports 7000, 7001 and 7002
- Nginx HTTPS listener on port 8443
- existing routes `/stremio-sosac/`, `/stremio-sosac-subtitles/` and `/dashboard/`

The GameS deployment does **not** replace those routes or processes.

## Layout

```text
/home/ubuntu/games-calendar/
  repo/     Git checkout + games-api runtime data

/var/www/games-calendar/
  published static frontend

PM2:
  games-api -> 127.0.0.1:8787

Nginx :8443:
  /games/       static frontend
  /games-api/   reverse proxy to the API `/api/` routes
  /games-health reverse proxy to `/health`
```

## First installation

Run as the normal `ubuntu` user. The installer uses `sudo` only for the Nginx-readable web root and Nginx files/reload.

```bash
cd /home/ubuntu
mkdir -p games-calendar
git clone https://github.com/CaseyCZ/GameS-Calendar-Website.git games-calendar/repo
bash games-calendar/repo/games-api/deploy/stremio-server-install.sh
```

If `/home/ubuntu/games-calendar/repo` already exists, skip the clone and run the installer directly.

The installer creates timestamped backups before changing the current dashboard or Nginx site. It never deletes the existing Stremio locations.

## Updates

The existing dashboard receives a `games-api` card. Its **Update** button runs the fixed GameS updater through Bash:

```text
/home/ubuntu/games-calendar/repo/games-api/deploy/stremio-server-update.sh
```

That action:

1. syncs the GameS repository to `origin/main`,
2. publishes browser files into `/var/www/games-calendar`,
3. installs API production dependencies,
4. syntax-checks the API and deployment helpers,
5. starts/restarts only the `games-api` PM2 process,
6. saves the PM2 process list,
7. verifies `127.0.0.1:8787/health`.

The Stremio processes are not restarted by a GameS update.

## Dashboard

The installer patches `/home/ubuntu/stremio-dashboard/index.js` once and creates a timestamped backup. The patched dashboard is syntax-checked before PM2 restarts it. The GameS card shows PM2 status, Git revision, port, API reachability and provider-health count. The dashboard also gets a GameS API log button and a fixed `npm run audit` action. No arbitrary shell endpoint is exposed.

## Rollback

Nginx and dashboard backups are named with `backup-games-<timestamp>`. To remove GameS without touching Stremio:

```bash
pm2 delete games-api
pm2 save
sudo rm -f /etc/nginx/snippets/games-calendar.conf
sudo rm -rf /var/www/games-calendar
# restore the pre-GameS /etc/nginx/sites-available/default backup, then:
sudo nginx -t && sudo systemctl reload nginx
```

Restore the matching `/home/ubuntu/stremio-dashboard/index.js.backup-games-*` file and restart `stremio-dashboard` if the dashboard patch also needs to be rolled back.
