#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const API_ROOT = String(process.env.GAMES_LIVE_API || 'https://130.61.49.108/games-api').replace(/\/$/, '');
const BATCH_SIZE = Math.max(1, Math.min(500, Number(process.env.IGDB_LIVE_BATCH_SIZE || 500)));
const RETRIES = Math.max(1, Math.min(8, Number(process.env.IGDB_LIVE_RETRIES || 5)));

const pad = value => String(value).padStart(2, '0');
const uniq = values => [...new Set((values || []).filter(Boolean))];

function generatedSummary(value = '') {
  return /\b(?:je videohra|je hra z kategorie)\b|\bDatum vydání:\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/i.test(String(value || ''));
}

function normalizePlatform(value = '') {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  if (!raw) return null;
  if (key === 'ps5' || key.includes('playstation 5')) return { id:null, name:'PlayStation 5', abbreviation:'PS5' };
  if (key === 'ps4' || key.includes('playstation 4')) return { id:null, name:'PlayStation 4', abbreviation:'PS4' };
  if (key.includes('xbox series')) return { id:null, name:'Xbox Series X|S', abbreviation:'XSX' };
  if (key.includes('xbox one')) return { id:null, name:'Xbox One', abbreviation:'XONE' };
  if (key.includes('switch 2')) return { id:null, name:'Nintendo Switch 2', abbreviation:'NSW2' };
  if (key.includes('nintendo switch') || key === 'switch') return { id:null, name:'Nintendo Switch', abbreviation:'NSW' };
  if (key === 'pc' || key.includes('windows')) return { id:null, name:'PC (Microsoft Windows)', abbreviation:'PC' };
  return { id:null, name:raw, abbreviation:raw };
}

function releaseBounds(release = {}) {
  if (release.day) return { from:release.day, to:release.day };
  const precision = String(release.precision || '').toLowerCase();
  const window = String(release.window || '');
  const year = Number((window.match(/\b(20\d{2})\b/) || [])[1] || 0);
  if (!year) return null;
  if (precision === 'year') return { from:`${year}-01-01`, to:`${year}-12-31` };
  const q = Number((precision.match(/^q([1-4])$/) || window.toLowerCase().match(/\bq([1-4])\b/) || [])[1] || 0);
  if (q) {
    const start = (q - 1) * 3 + 1;
    const end = q * 3;
    const endDay = new Date(Date.UTC(year, end, 0)).getUTCDate();
    return { from:`${year}-${pad(start)}-01`, to:`${year}-${pad(end)}-${pad(endDay)}` };
  }
  if (precision === 'month') {
    const numeric = window.match(/\b(0?[1-9]|1[0-2])[\/. -](20\d{2})\b/);
    const names = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
    const text = window.toLowerCase();
    const named = Object.entries(names).find(([name]) => new RegExp(`\\b${name}\\b`).test(text));
    const month = Number(numeric?.[1] || named?.[1] || 0);
    if (month) {
      const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { from:`${year}-${pad(month)}-01`, to:`${year}-${pad(month)}-${pad(endDay)}` };
    }
  }
  return null;
}

function overlapsCatalog(release, range) {
  if (!range) return true;
  const bounds = releaseBounds(release);
  if (!bounds) return true;
  return (!range.from || bounds.to >= range.from) && (!range.to || bounds.from <= range.to);
}

function buildReleases(item, range) {
  const map = new Map();
  for (const source of item.releaseDates || []) {
    if (!overlapsCatalog(source, range)) continue;
    const precision = String(source.precision || (source.day ? 'day' : 'unknown')).toLowerCase();
    const day = precision === 'day' ? source.day || null : null;
    const window = precision === 'day' ? '' : String(source.window || 'TBA');
    const key = `${day || ''}|${window.toLowerCase()}|${precision}`;
    if (!map.has(key)) map.set(key, {
      date: day,
      timestamp: day ? Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) : 0,
      platforms: [],
      window,
      precision,
      regions: []
    });
    const platform = normalizePlatform(source.platform);
    const target = map.get(key);
    if (platform && !target.platforms.some(existing => existing.name === platform.name)) target.platforms.push(platform);
  }
  return [...map.values()].sort((a, b) => {
    const ak = releaseBounds({day:a.date, window:a.window, precision:a.precision})?.from || '9999-12-31';
    const bk = releaseBounds({day:b.date, window:b.window, precision:b.precision})?.from || '9999-12-31';
    return ak.localeCompare(bk);
  });
}

async function requestBatch(ids, attempt = 0) {
  try {
    const response = await fetch(`${API_ROOT}/igdb/catalog-batch`, {
      method:'POST',
      headers:{'content-type':'application/json', Accept:'application/json'},
      body:JSON.stringify({ ids })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0,240)}`);
    return JSON.parse(text);
  } catch (error) {
    if (attempt + 1 >= RETRIES) throw error;
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    return requestBatch(ids, attempt + 1);
  }
}

function mergeGame(game, item, range) {
  const releases = buildReleases(item, range);
  return {
    ...game,
    summary: item.description && generatedSummary(game.summary) ? item.description : game.summary,
    aliases: uniq([...(game.aliases || []), ...(item.aliases || [])]),
    genres: uniq([...(game.genres || []), ...(item.genres || [])]),
    developers: item.developers?.length ? uniq(item.developers) : (game.developers || []),
    publishers: item.publishers?.length ? uniq(item.publishers) : (game.publishers || []),
    series: uniq([...(game.series || []), ...(item.series || [])]),
    rating: Number(item.rating || game.rating || 0) || 0,
    ratingCount: Number(item.ratingCount || game.ratingCount || 0) || 0,
    contentType: game.contentType || item.gameType || '',
    igdbId: String(item.providerId || game.igdbId || ''),
    igdbUrl: item.storeUrl || game.igdbUrl || '',
    links: { ...(game.links || {}), igdb:item.storeUrl || game.links?.igdb || game.igdbUrl || '' },
    releases: releases.length ? releases : game.releases,
    metadataSources: uniq([...(game.metadataSources || []), 'IGDB']),
    igdbStatus:'matched',
    igdbCheckedAt:new Date().toISOString()
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const games = Array.isArray(payload.games) ? payload.games : [];
  const ids = uniq(games.map(game => String(game.igdbId || '')).filter(value => /^\d+$/.test(value))).map(Number);
  if (!ids.length) {
    console.log('Live IGDB: no catalog IDs to enrich');
    return;
  }

  const byId = new Map();
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    const result = await requestBatch(batch);
    for (const item of result.items || []) byId.set(String(item.providerId), item);
    console.log(`Live IGDB: ${Math.min(offset + batch.length, ids.length)}/${ids.length} IDs, matched=${byId.size}`);
  }

  let changed = 0;
  payload.games = games.map(game => {
    const item = byId.get(String(game.igdbId || ''));
    if (!item) return game;
    changed += 1;
    return mergeGame(game, item, payload.range);
  });
  payload.generatedAt = new Date().toISOString();
  payload.provider = 'IGDB release and metadata + official Steam/Xbox metadata + Wikidata/Wikipedia fallback + official subscription catalogs';
  await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Live IGDB: enriched ${changed}/${games.length} catalog games`);
}

main().catch(error => {
  console.error('Live IGDB enrichment failed:', error);
  process.exitCode = 1;
});
