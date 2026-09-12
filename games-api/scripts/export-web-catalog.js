#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readCatalog } from '../src/db.js';

const output = path.resolve(process.env.GAMES_WEB_CATALOG_OUTPUT || './data/catalog-web.json');
const payload = readCatalog();

if (!payload?.games?.length) {
  console.error('SQLite catalog is empty.');
  process.exit(2);
}

const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const uniq = values => [...new Set((values || []).filter(Boolean))];

function shortSummary(game) {
  const value = text(game.summary || game.storyline || '');
  if (value.length <= 280) return value;
  const head = value.slice(0, 280);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return end > 160 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : 277)}…`;
}

function screenshotOne(game) {
  const first = Array.isArray(game.screenshots) ? game.screenshots.find(Boolean) : null;
  if (!first) return [];
  if (typeof first === 'string') return [{ full: first, thumb: first }];
  const full = first.full || first.url || first.path_full || '';
  if (!full) return [];
  return [{ full, thumb: first.thumb || first.path_thumbnail || full }];
}

function compactPlatform(platform) {
  if (typeof platform === 'string') return platform;
  if (!platform || typeof platform !== 'object') return null;
  return {
    id: platform.id ?? null,
    name: platform.name || platform.abbreviation || platform.abbr || '',
    abbreviation: platform.abbreviation || platform.abbr || ''
  };
}

function compactRelease(release) {
  return {
    date: release.date || release.day || null,
    timestamp: release.timestamp || 0,
    window: release.window || release.releaseWindow || '',
    precision: release.precision || release.datePrecision || '',
    regions: uniq(release.regions || []),
    platforms: (release.platforms || []).map(compactPlatform).filter(Boolean)
  };
}

function compactLinks(links = {}, game = {}) {
  const out = {};
  for (const key of ['official','steam','epic','reddit','youtube','wikipedia','igdb','xbox','playstation','nintendo']) {
    const value = links[key] || (key === 'igdb' ? game.igdbUrl : '');
    if (value) out[key] = value;
  }
  return out;
}

function compactGame(game) {
  const subscriptions = game.subscriptions || {};
  return {
    id: game.id,
    name: game.name,
    slug: game.slug || '',
    aliases: uniq(game.aliases || []),
    summary: shortSummary(game),
    cover: game.cover || '',
    genres: uniq(game.genres || []),
    developers: uniq(game.developers || []),
    publishers: uniq(game.publishers || []),
    series: uniq(game.series || []),
    scale: game.scale || '',
    contentType: game.contentType || '',
    earlyAccess: Boolean(game.earlyAccess),
    rating: Number(game.rating || 0) || 0,
    ratingCount: Number(game.ratingCount || 0) || 0,
    trailerId: game.trailerId || '',
    trailerUrl: game.trailerUrl || '',
    screenshots: screenshotOne(game),
    subscriptions: {
      gamePass: Boolean(subscriptions.gamePass),
      gamePassConsole: Boolean(subscriptions.gamePassConsole),
      gamePassPc: Boolean(subscriptions.gamePassPc),
      cloudGaming: Boolean(subscriptions.cloudGaming),
      psPlus: Boolean(subscriptions.psPlus),
      geforceNow: Boolean(subscriptions.geforceNow)
    },
    regionalReleases: Array.isArray(game.regionalReleases) ? game.regionalReleases.slice(0, 8) : [],
    announcedWindow: game.announcedWindow || '',
    links: compactLinks(game.links, game),
    releases: (game.releases || []).map(compactRelease)
  };
}

const web = {
  version: payload.version || 2,
  provider: payload.provider || 'igdb+official-stores',
  generatedAt: payload.generatedAt || new Date().toISOString(),
  range: payload.range || null,
  source: 'sqlite-web-feed',
  games: payload.games.map(compactGame)
};

fs.mkdirSync(path.dirname(output), { recursive: true });
const tmp = `${output}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(web));
fs.renameSync(tmp, output);
const size = fs.statSync(output).size;
console.log(`WEB CATALOG = ${web.games.length} games`);
console.log(`OUTPUT = ${output}`);
console.log(`SIZE = ${(size / 1024 / 1024).toFixed(1)} MB`);
