#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const file = process.env.GAMES_INPUT || 'games.json';
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const games = Array.isArray(payload.games) ? payload.games : [];
if (!games.length) {
  console.error('catalog: no games');
  process.exit(1);
}

const ids = new Map();
const igdbIds = new Map();
let releases = 0;
let invalid = 0;
let fuzzy = 0;
let boundary = 0;
let covers = 0;
let ratings = 0;
let generated = 0;
let screenshots = 0;

for (const game of games) {
  if (!game?.id || !String(game.name || '').trim() || !Array.isArray(game.releases)) invalid += 1;
  const id = String(game.id || '');
  ids.set(id, (ids.get(id) || 0) + 1);
  if (game.igdbId) {
    const key = String(game.igdbId);
    igdbIds.set(key, (igdbIds.get(key) || 0) + 1);
  }
  if (game.cover) covers += 1;
  if (Number(game.rating || 0) > 0) ratings += 1;
  if ((game.screenshots || []).length) screenshots += 1;
  if (/\b(?:je videohra|je hra z kategorie)\b|\bDatum vydání:\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/i.test(String(game.summary || ''))) generated += 1;

  for (const release of game.releases || []) {
    releases += 1;
    const date = String(release.date || release.day || '');
    const precision = String(release.precision || (date ? 'day' : 'unknown')).toLowerCase();
    if (precision !== 'day') fuzzy += 1;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid += 1;
    if (precision === 'day' && !date) invalid += 1;
    if (precision !== 'day' && date) invalid += 1;
    if (precision === 'day' && /-(03-31|06-30|09-30|12-31)$/.test(date)) boundary += 1;
  }
}

const duplicateIds = [...ids.values()].filter(count => count > 1).length;
const duplicateIgdbIds = [...igdbIds.values()].filter(count => count > 1).length;
const pct = value => Number((value / games.length * 100).toFixed(1));
const releasePct = value => Number((value / Math.max(1, releases) * 100).toFixed(1));

const report = {
  generatedAt: payload.generatedAt || null,
  games: games.length,
  releases,
  coverage: {
    covers: pct(covers),
    ratings: pct(ratings),
    screenshots: pct(screenshots),
    generatedDescriptions: pct(generated)
  },
  releaseQuality: {
    fuzzy,
    suspiciousBoundaryDays: boundary,
    suspiciousBoundaryPct: releasePct(boundary)
  },
  duplicates: {
    ids: duplicateIds,
    igdbIds: duplicateIgdbIds
  },
  invalid
};

console.log(JSON.stringify(report, null, 2));

if (duplicateIgdbIds) console.warn(`::warning::catalog has ${duplicateIgdbIds} duplicated IGDB identities; enrichment will merge them`);
if (releasePct(boundary) > 15) console.warn(`::warning::${releasePct(boundary)}% of releases are exact quarter/year boundary dates; run IGDB precision repair`);
if (pct(generated) > 40) console.warn(`::warning::${pct(generated)}% of descriptions are generated fallbacks`);

if (invalid || duplicateIds) {
  console.error(`catalog structural validation failed: invalid=${invalid}, duplicateIds=${duplicateIds}`);
  process.exit(1);
}
