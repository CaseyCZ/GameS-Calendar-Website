#!/usr/bin/env node
import fs from 'node:fs';
import { readCatalog } from '../src/db.js';

function loadCatalog() {
  const sqlite = readCatalog();
  if (sqlite?.games?.length) return sqlite;
  for (const file of [process.env.GAMES_RUNTIME_CATALOG_FILE || './data/catalog-runtime.json', '/var/www/games-calendar/games.json']) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(payload?.games)) return payload;
    } catch {}
  }
  throw new Error('No catalog available');
}

const payload = loadCatalog();
const games = payload.games || [];
const count = fn => games.reduce((sum, game) => sum + (fn(game) ? 1 : 0), 0);
const pct = n => games.length ? `${(n / games.length * 100).toFixed(1)}%` : '0%';
const rows = [];

for (const [name, fn] of Object.entries({
  genres: game => game.genres?.length,
  developers: game => game.developers?.length,
  publishers: game => game.publishers?.length,
  series: game => game.series?.length,
  scale: game => game.scale,
  contentType: game => game.contentType,
  earlyAccess: game => game.earlyAccess,
  screenshots: game => game.screenshots?.length,
  trailer: game => game.trailerId || game.trailerUrl,
  rating: game => Number(game.rating || 0) > 0,
  description: game => game.summary || game.storyline,
  subscriptions: game => game.subscriptions && Object.values(game.subscriptions).some(Boolean),
  gamePass: game => game.subscriptions?.gamePass || game.subscriptions?.gamePassConsole || game.subscriptions?.gamePassPc,
  cloudGaming: game => game.subscriptions?.cloudGaming,
  psPlus: game => game.subscriptions?.psPlus,
  geforceNow: game => game.subscriptions?.geforceNow,
  steamId: game => game.externalIds?.steam || game.steamId,
  microsoftId: game => game.externalIds?.microsoft || game.externalIds?.xbox,
  playstationId: game => game.externalIds?.playstation || game.externalIds?.playstationProduct || game.externalIds?.playstationConcept,
  nintendoId: game => game.externalIds?.nintendo
})) {
  const n = count(fn);
  rows.push([name, n, pct(n)]);
}

console.log(`API CATALOG provider=${payload.provider || ''}`);
console.log(`RANGE=${JSON.stringify(payload.range || null)}`);
console.log(`GAMES=${games.length}`);
console.log('\n=== FIELD COVERAGE ===');
for (const [name, n, p] of rows) console.log(`${name.padEnd(16)} ${String(n).padStart(7)}  ${p}`);

const platforms = new Map();
for (const game of games) {
  for (const release of game.releases || []) {
    for (const platform of release.platforms || []) {
      const name = typeof platform === 'string' ? platform : platform?.name || platform?.abbreviation || '';
      if (name) platforms.set(name, (platforms.get(name) || 0) + 1);
    }
  }
}
console.log('\n=== PLATFORMS ===');
for (const [name, n] of [...platforms].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`${String(n).padStart(7)}  ${name}`);

const genres = new Map();
for (const game of games) for (const genre of game.genres || []) if (genre) genres.set(String(genre), (genres.get(String(genre)) || 0) + 1);
console.log('\n=== GENRES ===');
for (const [name, n] of [...genres].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`${String(n).padStart(7)}  ${name}`);

const types = new Map();
const scales = new Map();
for (const game of games) {
  const type = String(game.contentType || 'Nezařazeno');
  const scale = String(game.scale || 'Nezařazeno');
  types.set(type, (types.get(type) || 0) + 1);
  scales.set(scale, (scales.get(scale) || 0) + 1);
}
console.log('\n=== CONTENT TYPES ===');
for (const [name, n] of [...types].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(7)}  ${name}`);
console.log('\n=== SCALE ===');
for (const [name, n] of [...scales].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(7)}  ${name}`);

const bad = [];
const priceRx = /price|currency|discount|msrp/i;
function walk(value, path = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (priceRx.test(key)) bad.push(next);
    walk(child, next);
  }
}
walk(payload);
console.log('\n=== PRICE-LIKE KEYS ===');
console.log(`COUNT=${bad.length}`);
for (const item of bad.slice(0, 30)) console.log(item);

const hardFailures = [];
if (!games.length) hardFailures.push('catalog is empty');
if (!count(game => game.genres?.length)) hardFailures.push('genres are empty');
if (!platforms.size) hardFailures.push('platforms are empty');
if (bad.length) hardFailures.push(`price-like keys detected: ${bad.length}`);

if (hardFailures.length) {
  console.error('\nAUDIT=FAIL');
  hardFailures.forEach(item => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('\nAUDIT=OK');
}
