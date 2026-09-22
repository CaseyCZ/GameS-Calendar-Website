#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const INPUT = path.resolve(process.env.GAMES_INPUT || 'games.json');
const OUTPUT = path.resolve(process.env.GAMES_INDEX_OUTPUT || 'games-index.json');

function richness(game = {}) {
  return [
    game.cover,
    game.summary,
    Number(game.rating || 0) > 0,
    Number(game.ratingCount || 0) > 0,
    (game.screenshots || []).length,
    game.trailerId || game.trailerUrl,
    (game.developers || []).length,
    (game.publishers || []).length,
    game.steamId
  ].reduce((score, value) => score + (value ? 1 : 0), 0);
}

function dedupeGames(games = []) {
  const out = [];
  const indexByIdentity = new Map();
  for (const game of games) {
    const identity = game.igdbId ? `igdb:${game.igdbId}` : `id:${game.id}`;
    if (!indexByIdentity.has(identity)) {
      indexByIdentity.set(identity, out.length);
      out.push(game);
      continue;
    }
    const index = indexByIdentity.get(identity);
    if (richness(game) > richness(out[index])) out[index] = game;
  }
  return out;
}

function compactSubscriptions(source = {}) {
  const out = {};
  for (const key of ['gamePass','gamePassConsole','gamePassPc','cloudGaming','psPlus','geforceNow']) {
    if (source?.[key]) out[key] = true;
  }
  return out;
}

function compactReleases(releases = []) {
  return releases.map(release => ({
    date: release.date || release.day || null,
    platforms: (release.platforms || []).map(platform =>
      typeof platform === 'string' ? platform : (platform.abbreviation || platform.name || '')
    ).filter(Boolean),
    window: release.window || '',
    precision: release.precision || ((release.date || release.day) ? 'day' : 'unknown'),
    ...(release.precisionSource ? { precisionSource: release.precisionSource } : {}),
    ...(release.regions?.length ? { regions: release.regions } : {})
  }));
}

function compactGame(game = {}) {
  return {
    id: game.id,
    igdbId: game.igdbId || '',
    name: game.name || '',
    slug: game.slug || '',
    aliases: game.aliases || [],
    cover: game.cover || '',
    genres: game.genres || [],
    developers: game.developers || [],
    publishers: game.publishers || [],
    series: game.series || [],
    scale: game.scale || '',
    contentType: game.contentType || '',
    earlyAccess: Boolean(game.earlyAccess),
    rating: Number(game.rating || 0) || 0,
    ratingCount: Number(game.ratingCount || 0) || 0,
    announcedWindow: game.announcedWindow || '',
    subscriptions: compactSubscriptions(game.subscriptions),
    hasDescription: Boolean(String(game.summary || game.storyline || '').trim()),
    hasScreenshots: Boolean((game.screenshots || []).length),
    trailerId: game.trailerId || '',
    releases: compactReleases(game.releases || [])
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  if (!Array.isArray(payload.games)) throw new Error('games.json has no games array');
  const compact = {
    version: Number(payload.version || 5),
    compact: true,
    generatedAt: payload.generatedAt || null,
    range: payload.range || null,
    provider: payload.provider || '',
    games: dedupeGames(payload.games).map(compactGame)
  };
  const tmp = `${OUTPUT}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(compact));
  await fs.rename(tmp, OUTPUT);
  const stat = await fs.stat(OUTPUT);
  console.log(`Web index: ${compact.games.length}/${payload.games.length} unique games, ${Math.round(stat.size / 1024)} KiB`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
