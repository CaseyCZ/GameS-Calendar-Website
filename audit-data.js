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
const normalizedTitles = new Map();
let releases = 0;
let invalid = 0;
let fuzzy = 0;
let boundary = 0;
const exactDateCounts = new Map();
const untrustedBoundaryCounts = new Map();
const untrustedExactDateCounts = new Map();
let missingPrecisionSource = 0;
let covers = 0;
let ratings = 0;
let generated = 0;
let screenshots = 0;
let genres = 0;
let developers = 0;
let publishers = 0;
const platformAliasCounts = new Map();

for (const game of games) {
  if (!game?.id || !String(game.name || '').trim() || !Array.isArray(game.releases)) invalid += 1;
  const id = String(game.id || '');
  ids.set(id, (ids.get(id) || 0) + 1);
  const normalizedTitle = String(game.name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalizedTitle) {
    const group = normalizedTitles.get(normalizedTitle) || [];
    group.push({
      id,
      igdbId: game.igdbId ? String(game.igdbId) : '',
      name: String(game.name || ''),
      contentType: String(game.contentType || ''),
      releases: (game.releases || []).map(item => String(item.date || item.day || item.window || '')).filter(Boolean)
    });
    normalizedTitles.set(normalizedTitle, group);
  }
  if (game.igdbId) {
    const key = String(game.igdbId);
    igdbIds.set(key, (igdbIds.get(key) || 0) + 1);
  }
  if (game.cover) covers += 1;
  if (Number(game.rating || 0) > 0) ratings += 1;
  if ((game.screenshots || []).length) screenshots += 1;
  if ((game.genres || []).length) genres += 1;
  if ((game.developers || []).length) developers += 1;
  if ((game.publishers || []).length) publishers += 1;
  if (/\b(?:je videohra|je hra z kategorie)\b|\bDatum vydání:\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/i.test(String(game.summary || ''))) generated += 1;

  for (const release of game.releases || []) {
    releases += 1;
    const date = String(release.date || release.day || '');
    const precision = String(release.precision || (date ? 'day' : 'unknown')).toLowerCase();
    if (precision !== 'day') fuzzy += 1;
    if (!release.precisionSource) missingPrecisionSource += 1;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid += 1;
    if (precision === 'day' && !date) invalid += 1;
    if (precision !== 'day' && date) invalid += 1;
    if (precision === 'day' && date) {
      exactDateCounts.set(date, (exactDateCounts.get(date) || 0) + 1);
      if (!String(release.precisionSource || '').startsWith('igdb-date-format')) {
        untrustedExactDateCounts.set(date, (untrustedExactDateCounts.get(date) || 0) + 1);
      }
    }
    if (precision === 'day' && /-(03-31|06-30|09-30|12-31)$/.test(date)) {
      boundary += 1;
      if (!String(release.precisionSource || '').startsWith('igdb-date-format')) {
        untrustedBoundaryCounts.set(date, (untrustedBoundaryCounts.get(date) || 0) + 1);
      }
    }
    for (const platform of release.platforms || []) {
      const name = String(platform?.name || platform?.abbreviation || '').trim();
      if (['Series X|S','XONE','browser'].includes(name)) {
        platformAliasCounts.set(name, (platformAliasCounts.get(name) || 0) + 1);
      }
    }
  }
}

const duplicateIds = [...ids.values()].filter(count => count > 1).length;
const duplicateIgdbIds = [...igdbIds.values()].filter(count => count > 1).length;
const sameTitleGroups = [...normalizedTitles.entries()]
  .filter(([, group]) => group.length > 1)
  .map(([title, group]) => ({ title, count: group.length, games: group }));
const duplicateTitleGroups = sameTitleGroups.length;
const exactDateTotal = [...exactDateCounts.values()].reduce((sum, count) => sum + count, 0);
const topExactDates = [...exactDateCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([date, count]) => ({ date, count, shareOfExactPct: Number((count / Math.max(1, exactDateTotal) * 100).toFixed(1)) }));
const pct = value => Number((value / games.length * 100).toFixed(1));
const releasePct = value => Number((value / Math.max(1, releases) * 100).toFixed(1));
const placeholderThreshold = Math.max(25, Math.ceil(games.length * 0.006));
const massPlaceholderDates = [...exactDateCounts.entries()]
  .filter(([date, count]) => {
    const match = date.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (!match || count < placeholderThreshold) return false;
    const [, year, month, day] = match;
    const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    const boundaryDay = Number(day) === 1 || Number(day) === last;
    const untrusted = Number(untrustedExactDateCounts.get(date) || 0);
    return boundaryDay && untrusted > 0;
  })
  .map(([date, count]) => ({ date, count }));

const report = {
  generatedAt: payload.generatedAt || null,
  games: games.length,
  releases,
  coverage: {
    covers: pct(covers),
    ratings: pct(ratings),
    screenshots: pct(screenshots),
    genres: pct(genres),
    developers: pct(developers),
    publishers: pct(publishers),
    generatedDescriptions: pct(generated)
  },
  releaseQuality: {
    fuzzy,
    fuzzyPct: releasePct(fuzzy),
    suspiciousBoundaryDays: boundary,
    suspiciousBoundaryPct: releasePct(boundary),
    massPlaceholderDates,
    topExactDates,
    missingPrecisionSource,
    untrustedBoundaryDays: [...untrustedBoundaryCounts.entries()].map(([date, count]) => ({ date, count }))
  },
  platformQuality: {
    legacyAliases: Object.fromEntries(platformAliasCounts)
  },
  duplicates: {
    ids: duplicateIds,
    igdbIds: duplicateIgdbIds,
    normalizedTitleGroups: duplicateTitleGroups
  },
  invalid
};

console.log(JSON.stringify(report, null, 2));

const hardFailures = [];
if (duplicateIds) hardFailures.push(`duplicateIds=${duplicateIds}`);
if (duplicateIgdbIds) hardFailures.push(`duplicateIgdbIds=${duplicateIgdbIds}`);
if (duplicateTitleGroups > Math.max(20, Math.ceil(games.length * 0.005))) {
  hardFailures.push(`normalizedTitleGroups=${duplicateTitleGroups}`);
} else if (duplicateTitleGroups) {
  console.warn(`::warning::${duplicateTitleGroups} normalized title groups need manual identity review`);
}
if (missingPrecisionSource > Math.max(100, Math.ceil(releases * 0.03))) hardFailures.push(`missingPrecisionSource=${missingPrecisionSource}`);
if (invalid) hardFailures.push(`invalid=${invalid}`);
if (massPlaceholderDates.length) hardFailures.push(`massPlaceholderDates=${massPlaceholderDates.map(item => `${item.date}:${item.count}`).join(',')}`);
if (untrustedBoundaryCounts.size) hardFailures.push(`untrustedBoundaryDates=${[...untrustedBoundaryCounts.entries()].map(([date,count]) => `${date}:${count}`).join(',')}`);
if ([...platformAliasCounts.values()].reduce((sum, count) => sum + count, 0)) hardFailures.push(`legacyPlatformAliases=${JSON.stringify(Object.fromEntries(platformAliasCounts))}`);
if (pct(covers) < 95) hardFailures.push(`coverCoverage=${pct(covers)}%`);
if (pct(genres) < 90) hardFailures.push(`genreCoverage=${pct(genres)}%`);

if (duplicateTitleGroups > Math.ceil(games.length * 0.03)) console.warn(`::warning::${duplicateTitleGroups} normalized title groups map to multiple game IDs; review editions/remasters`);
if (pct(generated) > 20) console.warn(`::warning::${pct(generated)}% of descriptions are generated fallbacks`);
if (pct(developers) < 60) console.warn(`::warning::developer coverage is only ${pct(developers)}%`);
if (pct(publishers) < 55) console.warn(`::warning::publisher coverage is only ${pct(publishers)}%`);
if (pct(ratings) < 10) console.warn(`::warning::rating coverage is only ${pct(ratings)}%; rating sorting will be sparse for upcoming games`);
if (releasePct(fuzzy) < 1) console.warn('::warning::almost all releases are marked as exact days; verify IGDB date precision mapping');
if (topExactDates[0]?.shareOfExactPct > 8) console.warn(`::warning::${topExactDates[0].shareOfExactPct}% of exact releases share ${topExactDates[0].date}; verify source distribution`);

if (hardFailures.length) {
  console.error(`catalog quality gate failed: ${hardFailures.join(', ')}`);
  process.exit(1);
}
