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

function releaseYear(release = {}) {
  if (release.day || release.date) return Number(String(release.day || release.date).slice(0, 4)) || 0;
  const match = String(release.window || '').match(/\b(20\d{2})\b/);
  return Number(match?.[1] || 0);
}

function fuzzyReleaseBounds(release = {}) {
  const precision = String(release.precision || '').toLowerCase();
  const year = releaseYear(release);
  if (!year) return null;
  if (precision === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  const quarter = precision.match(/^q([1-4])$/);
  if (quarter) {
    const q = Number(quarter[1]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return {
      from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      to: `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
    };
  }
  if (precision === 'month') {
    const numeric = String(release.window || '').match(/\b(0?[1-9]|1[0-2])[\/. -](20\d{2})\b/);
    const monthNames = {
      jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
      jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,
      nov:11,november:11,dec:12,december:12
    };
    const text = String(release.window || '').toLowerCase();
    const named = Object.entries(monthNames).find(([name]) => new RegExp(`\\b${name}\\b`).test(text));
    const month = Number(numeric?.[1] || named?.[1] || 0);
    if (!month) return null;
    const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      from: `${year}-${String(month).padStart(2, '0')}-01`,
      to: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
    };
  }
  return null;
}

function releaseOverlapsRange(release, range) {
  if (!range) return true;
  const day = release.day || release.date;
  if (day) return inRange(day, range);
  const bounds = fuzzyReleaseBounds(release);
  if (!bounds) return true;
  return (!range.from || bounds.to >= range.from) && (!range.to || bounds.from <= range.to);
}

function suspiciousPlaceholder(game) {
  return (game.releases || []).some(release => {
    const day = String(release.date || release.day || '');
    if (String(release.precision || 'day').toLowerCase() !== 'day' || !/^20\d{2}-\d{2}-\d{2}$/.test(day)) return false;
    if (String(release.precisionSource || '').startsWith('igdb-date-format')) return false;
    const [year, month, date] = day.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return date === 1 || date === last;
  });
}

function needsRefresh(game) {
  if (FORCE || suspiciousPlaceholder(game) || !game.igdbCheckedAt || !['matched', 'not-found'].includes(game.igdbStatus)) return true;
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

function releaseKey(release = {}) {
  return [
    release.date || release.day || '',
    String(release.window || '').trim().toLowerCase(),
    String(release.precision || (release.date || release.day ? 'day' : 'unknown')).toLowerCase()
  ].join('|');
}

function fuzzyCoversPlaceholder(source, day) {
  const bounds = fuzzyReleaseBounds(source);
  return Boolean(bounds && day >= bounds.from && day <= bounds.to);
}

function mergeReleasePlatforms(game, item, range) {
  const igdbSources = (item.releaseDates || []).filter(source => releaseOverlapsRange(source, range));
  const exactIgdbDays = new Set(igdbSources.map(source => source.day).filter(Boolean));
  const fuzzyIgdb = igdbSources.filter(source => !source.day && source.precision && source.precision !== 'unknown');

  const releases = (Array.isArray(game.releases) ? game.releases : [])
    .map(release => ({
      ...release,
      platforms: Array.isArray(release.platforms) ? [...release.platforms] : []
    }))
    .filter(release => {
      const day = String(release.date || release.day || '');
      if (!day) return true;
      if (exactIgdbDays.has(day)) return true;
      const boundary = /-(03-31|06-30|09-30|12-31)$/.test(day);
      if (!boundary) return true;
      return !fuzzyIgdb.some(source => fuzzyCoversPlaceholder(source, day));
    });

  for (const source of igdbSources) {
    const precision = source.precision || (source.day ? 'day' : 'unknown');
    const nextPlatform = source.platform ? platform(source.platform) : null;
    const candidate = {
      date: precision === 'day' ? source.day : null,
      timestamp: precision === 'day' ? timestamp(source.day) : 0,
      platforms: nextPlatform ? [nextPlatform] : [],
      window: precision === 'day' ? '' : (source.window || 'TBA'),
      precision,
      precisionSource: 'igdb-date-format',
      regions: []
    };
    let release = releases.find(entry => releaseKey(entry) === releaseKey(candidate));
    if (!release) {
      release = candidate;
      releases.push(release);
    } else if (nextPlatform && !release.platforms.some(entry => normalizeTitle(entry?.name || entry?.abbreviation) === normalizeTitle(nextPlatform.name))) {
      release.platforms.push(nextPlatform);
    }
  }

  const unique = new Map();
  for (const release of releases) {
    const key = releaseKey(release);
    if (!unique.has(key)) unique.set(key, release);
    else {
      const target = unique.get(key);
      for (const p of release.platforms || []) {
        if (!target.platforms.some(entry => normalizeTitle(entry?.name || entry?.abbreviation) === normalizeTitle(p?.name || p?.abbreviation))) {
          target.platforms.push(p);
        }
      }
    }
  }

  return [...unique.values()].sort((a, b) => {
    const ak = a.date || a.day || fuzzyReleaseBounds(a)?.from || '9999-12-31';
    const bk = b.date || b.day || fuzzyReleaseBounds(b)?.from || '9999-12-31';
    return ak.localeCompare(bk);
  });
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

function generatedSummary(value = '') {
  return /\b(?:je videohra|je hra z kategorie)\b|\bDatum vydání:\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/i.test(String(value || ''));
}

function mergeGame(game, item, range) {
  const trailers = item.media?.trailers || [];
  const trailerUrl = trailers[0] || game.trailerUrl || '';
  const now = new Date().toISOString();
  const betterSummary = item.description && (!game.summary || generatedSummary(game.summary)) ? item.description : game.summary;
  return {
    ...game,
    summary: betterSummary || '',
    aliases: uniq([...(game.aliases || []), ...(item.aliases || [])]),
    genres: uniq([...(game.genres || []), ...(item.genres || [])]),
    developers: item.developers?.length ? uniq(item.developers) : uniq(game.developers || []),
    publishers: item.publishers?.length ? uniq(item.publishers) : uniq(game.publishers || []),
    series: uniq([...(game.series || []), ...(item.series || [])]),
    cover: game.cover || item.media?.cover || '',
    rating: Number(item.rating || game.rating || 0) || 0,
    ratingCount: Number(item.ratingCount || game.ratingCount || 0) || 0,
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

function richness(game = {}) {
  return [
    game.cover, game.summary && !generatedSummary(game.summary), game.rating, game.ratingCount,
    (game.screenshots || []).length, game.trailerId || game.trailerUrl,
    (game.developers || []).length, (game.publishers || []).length, (game.genres || []).length,
    game.steamId, game.links?.steam, game.wikidataId
  ].reduce((score, value) => score + (Array.isArray(value) ? Math.min(3, value.length) : value ? 1 : 0), 0);
}

function mergeDuplicate(base, extra) {
  const preferred = richness(extra) > richness(base) ? extra : base;
  const secondary = preferred === base ? extra : base;
  const releases = [];
  const seen = new Map();
  for (const release of [...(preferred.releases || []), ...(secondary.releases || [])]) {
    const key = releaseKey(release);
    if (!seen.has(key)) {
      const copy = { ...release, platforms: [...(release.platforms || [])] };
      seen.set(key, copy);
      releases.push(copy);
    } else {
      const target = seen.get(key);
      for (const p of release.platforms || []) {
        if (!target.platforms.some(existing => normalizeTitle(existing?.name || existing?.abbreviation) === normalizeTitle(p?.name || p?.abbreviation))) {
          target.platforms.push(p);
        }
      }
    }
  }
  return {
    ...secondary,
    ...preferred,
    id: preferred.id,
    aliases: uniq([...(base.aliases || []), ...(extra.aliases || [])]),
    genres: uniq([...(base.genres || []), ...(extra.genres || [])]),
    developers: uniq([...(base.developers || []), ...(extra.developers || [])]),
    publishers: uniq([...(base.publishers || []), ...(extra.publishers || [])]),
    series: uniq([...(base.series || []), ...(extra.series || [])]),
    screenshots: [...(preferred.screenshots || []), ...(secondary.screenshots || [])].filter((item, index, all) => {
      const key = typeof item === 'string' ? item : item?.full || item?.thumb || JSON.stringify(item);
      return all.findIndex(other => (typeof other === 'string' ? other : other?.full || other?.thumb || JSON.stringify(other)) === key) === index;
    }),
    metadataSources: uniq([...(base.metadataSources || []), ...(extra.metadataSources || [])]),
    releases
  };
}

function dedupeGames(games = []) {
  const out = [];
  const byIgdb = new Map();
  for (const game of games) {
    const key = game.igdbId ? `igdb:${game.igdbId}` : '';
    if (!key || !byIgdb.has(key)) {
      const index = out.push(game) - 1;
      if (key) byIgdb.set(key, index);
      continue;
    }
    const index = byIgdb.get(key);
    out[index] = mergeDuplicate(out[index], game);
  }
  return out;
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
        let matchedItem = null;
        if (current.game.igdbId) {
          try {
            matchedItem = await igdbProvider.product(String(current.game.igdbId), { force: suspiciousPlaceholder(current.game) });
          } catch {
            matchedItem = null;
          }
        }
        if (!matchedItem) {
          const hits = await igdbProvider.search(current.game.name, { limit: 5, force: suspiciousPlaceholder(current.game) });
          const best = chooseHit(current.game, hits);
          if (best?.item && best.score >= 0.82) matchedItem = best.item;
        }
        const now = new Date().toISOString();
        if (matchedItem) {
          payload.games[current.index] = mergeGame(current.game, matchedItem, payload.range);
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
  payload.games = dedupeGames(payload.games);
  payload.generatedAt = new Date().toISOString();
  payload.provider = 'IGDB release and metadata + official Steam/Xbox metadata + Wikidata/Wikipedia fallback + official subscription catalogs';
  await save(payload);
  console.log(JSON.stringify({ total: payload.games.length, processed, matched, missed, output: OUTPUT }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
