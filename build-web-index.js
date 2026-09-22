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

function compactGame(game = {}) {
  const links = {
    official: game.links?.official || '',
    steam: game.links?.steam || '',
    igdb: game.links?.igdb || game.igdbUrl || ''
  };
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
    steamId: game.steamId || '',
    announcedWindow: game.announcedWindow || '',
    subscriptions: {
      gamePass: Boolean(game.subscriptions?.gamePass),
      gamePassConsole: Boolean(game.subscriptions?.gamePassConsole),
      gamePassPc: Boolean(game.subscriptions?.gamePassPc),
      cloudGaming: Boolean(game.subscriptions?.cloudGaming),
      psPlus: Boolean(game.subscriptions?.psPlus),
      geforceNow: Boolean(game.subscriptions?.geforceNow)
    },
    links,
    hasDescription: Boolean(String(game.summary || game.storyline || '').trim()),
    hasScreenshots: Boolean((game.screenshots || []).length),
    trailerId: game.trailerId || '',
    releases: game.releases || []
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
