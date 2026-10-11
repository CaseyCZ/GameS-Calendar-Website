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
  return releases.map(release => {
    const out = {};
    const date = release.date || release.day || null;
    const platforms = (release.platforms || []).map(platform =>
      typeof platform === 'string' ? platform : (platform.abbreviation || platform.name || '')
    ).filter(Boolean);
    const precision = release.precision || (date ? 'day' : 'unknown');

    if (date) out.date = date;
    if (platforms.length) out.platforms = platforms;
    if (release.window) out.window = release.window;
    if (precision !== 'day') out.precision = precision;
    if (release.precisionSource) out.precisionSource = release.precisionSource;
    if (release.regions?.length) out.regions = release.regions;
    return out;
  });
}

function compactGame(game = {}) {
  const out = {
    id: game.id,
    name: game.name || '',
    contentType: game.contentType || '',
    releases: compactReleases(game.releases || [])
  };

  if (game.igdbId) out.igdbId = game.igdbId;
  if (game.slug) out.slug = game.slug;
  if (game.aliases?.length) out.aliases = game.aliases;
  if (game.cover) out.cover = game.cover;
  if (game.genres?.length) out.genres = game.genres;
  if (game.developers?.length) out.developers = game.developers;
  if (game.publishers?.length) out.publishers = game.publishers;
  if (game.series?.length) out.series = game.series;
  if (game.scale) out.scale = game.scale;
  if (game.earlyAccess) out.earlyAccess = true;

  const rating = Number(game.rating || 0) || 0;
  const ratingCount = Number(game.ratingCount || 0) || 0;
  if (rating) out.rating = rating;
  if (ratingCount) out.ratingCount = ratingCount;
  if (game.announcedWindow) out.announcedWindow = game.announcedWindow;

  const subscriptions = compactSubscriptions(game.subscriptions);
  if (Object.keys(subscriptions).length) out.subscriptions = subscriptions;
  if (String(game.summary || game.storyline || '').trim()) out.hasDescription = true;
  if ((game.screenshots || []).length) out.hasScreenshots = true;
  if (game.trailerId) out.trailerId = game.trailerId;
  return out;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  if (!Array.isArray(payload.games)) throw new Error('games.json has no games array');
  const compact = {
    version: Number(payload.version || 5),
    compact: true,
    sparse: true,
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
