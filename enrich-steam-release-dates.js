#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const API_ROOT = String(process.env.GAMES_LIVE_API || 'https://130.61.49.108/games-api').replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.STEAM_RELEASE_CONCURRENCY || 6)));
const RETRIES = Math.max(1, Math.min(5, Number(process.env.STEAM_RELEASE_RETRIES || 3)));

function isPcPlatform(platform = {}) {
  const value = typeof platform === 'string'
    ? platform
    : `${platform?.name || ''} ${platform?.abbreviation || ''}`;
  return /\bpc\b|windows/i.test(String(value || ''));
}

function hasPcRelease(game = {}) {
  return (game.releases || []).some(release =>
    (release.platforms || []).some(isPcPlatform)
  );
}

function normalizeDay(value = '') {
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function updatedRelease(release, platforms, day) {
  const next = {
    ...release,
    date: day,
    timestamp: Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000),
    platforms,
    window: '',
    precision: 'day',
    precisionSource: 'steam-store-live'
  };
  delete next.day;
  return next;
}

function releaseIdentity(release = {}) {
  const date = release.date || release.day || '';
  const precision = release.precision || (date ? 'day' : 'unknown');
  const platforms = (release.platforms || [])
    .map(platform => typeof platform === 'string' ? platform : (platform.name || platform.abbreviation || ''))
    .filter(Boolean)
    .sort()
    .join('|');
  const regions = (release.regions || []).slice().sort().join('|');
  return `${date}|${precision}|${platforms}|${regions}`;
}

function applySteamReleaseDate(game, day) {
  const exactDay = normalizeDay(day);
  if (!game || !exactDay || !hasPcRelease(game)) return false;

  let changed = false;
  const next = [];

  for (const release of game.releases || []) {
    const platforms = Array.isArray(release.platforms) ? release.platforms : [];
    const pcPlatforms = platforms.filter(isPcPlatform);
    if (!pcPlatforms.length) {
      next.push(release);
      continue;
    }

    const otherPlatforms = platforms.filter(platform => !isPcPlatform(platform));
    const currentDay = normalizeDay(release.date || release.day);
    const alreadyExact = currentDay === exactDay
      && String(release.precision || 'day').toLowerCase() === 'day';

    if (otherPlatforms.length) {
      next.push({ ...release, platforms: otherPlatforms });
      next.push(updatedRelease(release, pcPlatforms, exactDay));
      changed = true;
      continue;
    }

    if (alreadyExact) {
      next.push(release);
      continue;
    }

    next.push(updatedRelease(release, pcPlatforms, exactDay));
    changed = true;
  }

  if (!changed) return false;

  const seen = new Set();
  game.releases = next.filter(release => {
    const key = releaseIdentity(release);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return true;
}

async function fetchSteamProduct(steamId, attempt = 0) {
  try {
    const response = await fetch(`${API_ROOT}/steam/${encodeURIComponent(steamId)}?refresh=1`, {
      headers: { Accept:'application/json' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    return JSON.parse(text);
  } catch (error) {
    if (attempt + 1 >= RETRIES) throw error;
    await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
    return fetchSteamProduct(steamId, attempt + 1);
  }
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const games = Array.isArray(payload.games) ? payload.games : [];
  const targets = games.filter(game => /^\d+$/.test(String(game.steamId || '')) && hasPcRelease(game));

  let checked = 0;
  let changed = 0;
  let failed = 0;

  await mapLimit(targets, CONCURRENCY, async game => {
    try {
      const item = await fetchSteamProduct(String(game.steamId));
      checked += 1;
      const day = normalizeDay(item?.releaseDate);
      if (!day) return;
      if (applySteamReleaseDate(game, day)) {
        changed += 1;
        console.log(`Steam release date: ${game.name} -> ${day}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`Steam release date failed: ${game.name} (${game.steamId}): ${error?.message || error}`);
    }
  });

  if (changed) {
    payload.generatedAt = new Date().toISOString();
    await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  }

  console.log(`Steam release dates: targets=${targets.length}, checked=${checked}, changed=${changed}, failed=${failed}`);
}

module.exports = {
  applySteamReleaseDate,
  hasPcRelease,
  isPcPlatform,
  normalizeDay
};

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
