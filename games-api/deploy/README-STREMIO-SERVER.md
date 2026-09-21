# GameS Calendar on the current Oracle Stremio server

This deployment is tailored to the existing host discovered on 2026-09-12:

- Node.js 24
- PM2 managed by the `ubuntu` user
- existing processes on ports 7000, 7001 and 7002
- Nginx HTTPS listeners on ports 443 and 8443
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

Nginx :443 and :8443:
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

Every push to `main` automatically runs `.github/workflows/deploy-server.yml`. GitHub Actions connects with a restricted SSH deployment key and executes:

```text
/home/ubuntu/games-calendar/repo/games-api/deploy/stremio-server-update.sh
```

The existing dashboard also keeps a manual **Update** button as a fallback.

The updater:

1. refuses tracked local changes or a branch other than `main`, then fast-forwards to `origin/main` without discarding local commits,
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

## Server-specific configuration notes

On the audited server, `/etc/nginx/sites-enabled/default` is a regular file, not a symlink to `sites-available/default`. Nginx loads the enabled file. Back up and update the active file, then run `sudo nginx -t` before reloading. Restoring only the available copy does not change the running site.

Keep local server fixes under version control before updating. The updater stops on tracked local changes; it does not reset or automatically stash them. Pushes to `main` deploy the server automatically; GitHub Pages remains a separate publication path.
