#!/usr/bin/env node
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { igdbProvider } from '../src/providers/igdb.js';
import { normalizeTitle, titleScore, uniq } from '../src/lib/normalize.js';

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || new URL('../../games.json', import.meta.url).pathname);
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.IGDB_ENRICH_CONCURRENCY || 4)));
const LIMIT = Math.max(0, Number(process.env.IGDB_ENRICH_LIMIT || 0));
const RETRY_DAYS = Math.max(1, Number(process.env.IGDB_ENRICH_RETRY_DAYS || 30));
const FORCE = ['1', 'true'].includes(String(process.env.IGDB_ENRICH_FORCE || '').toLowerCase());
const SAVE_EVERY = Math.max(10, Number(process.env.IGDB_ENRICH_SAVE_EVERY || 50));

const timestamp = day => day ? Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) : 0;
const inRange = (day, range) => Boolean(day && (!range?.from || day >= range.from) && (!range?.to || day <= range.to));

function needsRefresh(game) {
  if (FORCE || !game.igdbCheckedAt || !['matched', 'not-found'].includes(game.igdbStatus)) return true;
  const checked = Date.parse(game.igdbCheckedAt);
  return !Number.isFinite(checked) || Date.now() - checked >= RETRY_DAYS * 86400000;
}

function platform(value = '') {
  const raw = String(value).trim();
  const key = raw.toLowerCase();
  if (key === 'ps5' || key.includes('playstation 5')) return { id: null, name: 'PlayStation 5', abbreviation: 'PS5' };
  if (key === 'ps4' || key.includes('playstation 4')) return { id: null, name: 'PlayStation 4', abbreviation: 'PS4' };
  if (key === 'series x|s' || key.includes('xbox series')) return { id: null, name: 'Xbox Series X|S', abbreviation: 'XSX' };
  if (key === 'xone' || key.includes('xbox one')) return { id: null, name: 'Xbox One', abbreviation: 'XONE' };
  if (key === 'switch 2' || key.includes('nintendo switch 2')) return { id: null, name: 'Nintendo Switch 2', abbreviation: 'NSW2' };
  if (key === 'switch' || key.includes('nintendo switch')) return { id: null, name: 'Nintendo Switch', abbreviation: 'NSW' };
  if (key === 'pc' || key.includes('windows')) return { id: null, name: 'PC (Microsoft Windows)', abbreviation: 'PC' };
  return { id: null, name: raw, abbreviation: raw };
}

function youtubeId(value = '') {
  const text = String(value || '');
  if (/^[A-Za-z0-9_-]{6,20}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    return url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]+)/)?.[1] || '';
  } catch { return ''; }
}

function mergeReleasePlatforms(game, item, range) {
  const releases = Array.isArray(game.releases) ? game.releases.map(release => ({
    ...release,
    platforms: Array.isArray(release.platforms) ? [...release.platforms] : []
  })) : [];
  for (const source of item.releaseDates || []) {
    if (!inRange(source.day, range) || !source.platform) continue;
    const nextPlatform = platform(source.platform);
    let release = releases.find(entry => (entry.date || entry.day) === source.day);
    if (!release) {
      release = { date: source.day, timestamp: timestamp(source.day), platforms: [], window: '', precision: 'day', regions: [] };
      releases.push(release);
    }
    if (!release.platforms.some(entry => normalizeTitle(entry?.name || entry?.abbreviation) === normalizeTitle(nextPlatform.name))) {
      release.platforms.push(nextPlatform);
    }
  }
  return releases.sort((a, b) => String(a.date || a.day || '9999').localeCompare(String(b.date || b.day || '9999')));
}

function chooseHit(game, hits = []) {
  const baseYear = Number((game.releases || []).map(r => r.date || r.day).filter(Boolean).sort()[0]?.slice(0, 4) || 0);
  return hits.map(item => {
    let score = titleScore(game.name, item.title);
    const hitYear = Number(String(item.releaseDate || '').slice(0, 4) || 0);
    if (baseYear && hitYear) {
      const difference = Math.abs(baseYear - hitYear);
      if (difference <= 1) score += 0.08;
      else if (difference >= 4) score -= 0.2;
    }
    return { item, score };
  }).sort((a, b) => b.score - a.score)[0];
}

function mergeGame(game, item, range) {
  const trailers = item.media?.trailers || [];
  const trailerUrl = trailers[0] || game.trailerUrl || '';
  const now = new Date().toISOString();
  return {
    ...game,
    aliases: uniq([...(game.aliases || []), ...(item.aliases || [])]),
    genres: uniq([...(game.genres || []), ...(item.genres || [])]),
    developers: uniq([...(game.developers || []), ...(item.developers || [])]),
    publishers: uniq([...(game.publishers || []), ...(item.publishers || [])]),
    series: uniq([...(game.series || []), ...(item.series || [])]),
    cover: game.cover || item.media?.cover || '',
    rating: Number(game.rating || item.rating || 0) || 0,
    ratingCount: Number(game.ratingCount || item.ratingCount || 0) || 0,
    trailerId: game.trailerId || youtubeId(trailerUrl),
    trailerUrl,
    contentType: game.contentType || item.gameType || '',
    igdbId: String(item.providerId || ''),
    igdbUrl: item.storeUrl || '',
    links: { ...(game.links || {}), igdb: item.storeUrl || game.links?.igdb || '' },
    releases: mergeReleasePlatforms(game, item, range),
    metadataSources: uniq([...(game.metadataSources || []), 'IGDB']),
    igdbStatus: 'matched',
    igdbCheckedAt: now
  };
}

async function save(payload) {
  const temp = `${OUTPUT}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temp, OUTPUT);
}

async function main() {
  const payload = JSON.parse(await readFile(OUTPUT, 'utf8'));
  if (!Array.isArray(payload.games)) throw new Error('games.json has no games array');
  const candidates = payload.games.map((game, index) => ({ game, index })).filter(({ game }) => needsRefresh(game));
  const queue = LIMIT ? candidates.slice(0, LIMIT) : candidates;
  if (!queue.length) {
    console.log(JSON.stringify({ total: payload.games.length, processed: 0, matched: 0, missed: 0, output: OUTPUT }));
    return;
  }
  let cursor = 0;
  let processed = 0;
  let matched = 0;
  let missed = 0;
  let changedSinceSave = 0;

  async function worker() {
    while (cursor < queue.length) {
      const current = queue[cursor++];
      try {
        const hits = await igdbProvider.search(current.game.name, { limit: 5 });
        const best = chooseHit(current.game, hits);
        const now = new Date().toISOString();
        if (best?.item && best.score >= 0.82) {
          payload.games[current.index] = mergeGame(current.game, best.item, payload.range);
          matched += 1;
        } else {
          payload.games[current.index] = { ...current.game, igdbStatus: 'not-found', igdbCheckedAt: now };
          missed += 1;
        }
      } catch (error) {
        console.error(`IGDB ${current.game.name}: ${error?.message || error}`);
      }
      processed += 1;
      changedSinceSave += 1;
      if (changedSinceSave >= SAVE_EVERY) {
        changedSinceSave = 0;
        payload.generatedAt = new Date().toISOString();
        payload.provider = 'IGDB release and metadata + official Steam/Xbox metadata + Wikidata/Wikipedia fallback + official subscription catalogs';
        await save(payload);
      }
      if (processed % 25 === 0 || processed === queue.length) {
        console.log(`IGDB ${processed}/${queue.length}: matched=${matched}, not-found=${missed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  payload.generatedAt = new Date().toISOString();
  payload.provider = 'IGDB release and metadata + official Steam/Xbox metadata + Wikidata/Wikipedia fallback + official subscription catalogs';
  await save(payload);
  console.log(JSON.stringify({ total: payload.games.length, processed, matched, missed, output: OUTPUT }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
