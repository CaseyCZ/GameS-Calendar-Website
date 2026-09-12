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
  if (value.length <= 180) return value;
  const head = value.slice(0, 180);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return end > 100 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : 177)}…`;
}

function screenshotOne(game) {
  const first = Array.isArray(game.screenshots) ? game.screenshots.find(Boolean) : null;
  if (!first) return [];
  if (typeof first === 'string') return [{ full: first, thumb: first }];
  const full = first.full || first.url || first.path_full || '';
  if (!full) return [];
  return [{ full, thumb: first.thumb || first.path_thumbnail || full }];
}

function platformName(platform) {
  if (typeof platform === 'string') return platform;
  if (!platform || typeof platform !== 'object') return '';
  return platform.name || platform.abbreviation || platform.abbr || String(platform.id || '');
}

function compactRelease(release) {
  const out = {
    date: release.date || release.day || null,
    platforms: uniq((release.platforms || []).map(platformName).filter(Boolean))
  };
  const window = release.window || release.releaseWindow || '';
  const precision = release.precision || release.datePrecision || '';
  if (window) out.window = window;
  if (precision && precision !== 'day') out.precision = precision;
  return out;
}

function compactSubscriptions(subscriptions = {}) {
  const out = {};
  for (const key of ['gamePass','gamePassConsole','gamePassPc','cloudGaming','psPlus','geforceNow']) {
    if (subscriptions[key]) out[key] = true;
  }
  return Object.keys(out).length ? out : undefined;
}

function compactGame(game) {
  const out = {
    id: game.id,
    name: game.name,
    cover: game.cover || '',
    aliases: uniq(game.aliases || []).slice(0, 8),
    genres: uniq(game.genres || []),
    developers: uniq(game.developers || []),
    publishers: uniq(game.publishers || []),
    series: uniq(game.series || []),
    scale: game.scale || '',
    contentType: game.contentType || '',
    earlyAccess: Boolean(game.earlyAccess),
    rating: Number(game.rating || 0) || 0,
    ratingCount: Number(game.ratingCount || 0) || 0,
    summary: shortSummary(game),
    trailerId: game.trailerId || '',
    screenshots: screenshotOne(game),
    releases: (game.releases || []).map(compactRelease)
  };
  if (game.slug) out.slug = game.slug;
  const subscriptions = compactSubscriptions(game.subscriptions || {});
  if (subscriptions) out.subscriptions = subscriptions;
  return out;
}

const web = {
  version: 9,
  provider: payload.provider || 'igdb+official-stores',
  generatedAt: payload.generatedAt || new Date().toISOString(),
  range: payload.range || null,
  source: 'sqlite-web-index',
  games: payload.games.map(compactGame)
};

fs.mkdirSync(path.dirname(output), { recursive: true });
const tmp = `${output}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(web));
fs.renameSync(tmp, output);
const size = fs.statSync(output).size;
console.log(`WEB INDEX = ${web.games.length} games`);
console.log(`OUTPUT = ${output}`);
console.log(`SIZE = ${(size / 1024 / 1024).toFixed(1)} MB`);
