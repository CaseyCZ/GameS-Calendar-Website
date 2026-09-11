#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');

const API_KEY = process.env.RAWG_API_KEY;
const MONTHS_PAST = Math.max(0, Number(process.env.GAMES_MONTHS_PAST ?? 6));
const MONTHS_FUTURE = Math.max(1, Number(process.env.GAMES_MONTHS_FUTURE ?? 18));
const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const API = 'https://api.rawg.io/api';
const PAGE_SIZE = 40;
const DETAIL_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.RAWG_DETAIL_CONCURRENCY ?? 4)));
const MAX_RETRIES = 4;

if (!API_KEY) {
  console.error('❌ Chybí RAWG_API_KEY. Zdarma ho získáš na https://rawg.io/apidocs');
  process.exit(1);
}
if (typeof fetch !== 'function') {
  console.error('❌ Tento skript vyžaduje Node.js 18+ (globální fetch).');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pad = n => String(n).padStart(2, '0');
const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const uniq = values => [...new Set((values || []).filter(Boolean))];

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dayString(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dateWindow() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_PAST, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MONTHS_FUTURE, 0));
  return { from: dayString(from), to: dayString(to) };
}

async function rawg(pathname, params = {}, attempt = 0) {
  const url = new URL(`${API}${pathname}`);
  url.searchParams.set('key', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.ok) return response.json();

  const detail = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    const wait = Math.min(10_000, 700 * (2 ** attempt)) + Math.floor(Math.random() * 350);
    console.warn(`⚠️ RAWG HTTP ${response.status}; opakuji za ${wait} ms…`);
    await sleep(wait);
    return rawg(pathname, params, attempt + 1);
  }
  throw new Error(`RAWG ${pathname} HTTP ${response.status}: ${detail.slice(0, 400)}`);
}

async function loadPrevious() {
  try {
    const raw = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
    const byRawgId = new Map();
    const coverByName = new Map();

    if (raw && Array.isArray(raw.games)) {
      for (const game of raw.games) {
        const rawgId = Number(game.rawgId || game.source?.rawgId || 0);
        if (rawgId) byRawgId.set(rawgId, game);
        if (game.name && game.cover) coverByName.set(normalizeName(game.name), game.cover);
      }
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        const game = item?.game || item;
        if (game?.name && (game.cover?.url || game.cover)) {
          coverByName.set(normalizeName(game.name), game.cover?.url || game.cover);
        }
      }
    }
    return { byRawgId, coverByName };
  } catch {
    return { byRawgId: new Map(), coverByName: new Map() };
  }
}

async function discoverPlatforms() {
  const first = await rawg('/platforms', { page_size: 100, page: 1 });
  const all = [...(first.results || [])];
  let next = first.next;
  let page = 2;
  while (next && page <= 5) {
    const result = await rawg('/platforms', { page_size: 100, page });
    all.push(...(result.results || []));
    next = result.next;
    page += 1;
  }

  const wanted = all.filter(platform => {
    const name = String(platform.name || '').toLowerCase();
    return name === 'pc'
      || name === 'playstation 5'
      || /xbox series/.test(name)
      || name === 'nintendo switch'
      || name === 'nintendo switch 2'
      || /playstation vr|\bvr\b|quest|rift/.test(name);
  });

  if (!wanted.length) throw new Error('RAWG nevrátil žádné cílové platformy.');
  console.log('🎮 Platformy: ' + wanted.map(p => `${p.name} (${p.id})`).join(', '));
  return wanted;
}

async function fetchGameList(platformIds) {
  const { from, to } = dateWindow();
  const all = [];
  let page = 1;
  for (;;) {
    const payload = await rawg('/games', {
      dates: `${from},${to}`,
      platforms: platformIds.join(','),
      ordering: 'released',
      page_size: PAGE_SIZE,
      page,
      exclude_additions: true
    });
    all.push(...(payload.results || []));
    console.log(`📄 RAWG stránka ${page}: ${payload.results?.length || 0} her`);
    if (!payload.next || !(payload.results || []).length) break;
    page += 1;
  }
  console.log(`📚 Seznam: ${all.length} her (${from} – ${to})`);
  return { list: all, range: { from, to } };
}

function platformAbbreviation(name = '') {
  const n = String(name).toLowerCase();
  if (n === 'pc') return 'PC';
  if (n.includes('playstation 5')) return 'PS5';
  if (n.includes('xbox series')) return 'XSX';
  if (n.includes('switch 2')) return 'Switch 2';
  if (n.includes('nintendo switch')) return 'Switch';
  if (n.includes('playstation vr')) return 'PS VR';
  if (n.includes('quest')) return 'Quest';
  return name;
}

function releasesFromList(game, allowedPlatformIds) {
  const groups = new Map();
  for (const item of game.platforms || []) {
    const platform = item?.platform;
    if (!platform?.id || !allowedPlatformIds.has(platform.id)) continue;
    const date = item.released_at || game.released;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push({
      id: platform.id,
      name: platform.name || platform.slug || String(platform.id),
      abbreviation: platformAbbreviation(platform.name || platform.slug || '')
    });
  }

  if (!groups.size && /^\d{4}-\d{2}-\d{2}$/.test(game.released || '')) {
    groups.set(game.released, []);
  }

  return [...groups.entries()].map(([date, platforms]) => ({
    date,
    timestamp: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000),
    platforms: platforms.sort((a, b) => a.name.localeCompare(b.name))
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function listGenres(game) {
  return uniq((game.genres || []).map(item => item?.name));
}

function detailGenres(detail, fallback) {
  const genres = uniq((detail?.genres || []).map(item => item?.name));
  return genres.length ? genres : fallback;
}

function storesFromDetail(detail) {
  return uniq((detail?.stores || []).map(item => item?.store?.name));
}

function buildGame(listGame, detail, previous, allowedPlatformIds) {
  const releases = releasesFromList(listGame, allowedPlatformIds);
  const fallbackGenres = listGenres(listGame);
  const genres = detailGenres(detail, fallbackGenres);
  const developers = uniq((detail?.developers || []).map(item => item?.name));
  const publishers = uniq((detail?.publishers || []).map(item => item?.name));
  const rawDescription = cleanText(detail?.description_raw || detail?.description || previous?.summary || '');
  const cover = previous?.cover || detail?.background_image || listGame.background_image || '';
  const metacritic = Number(detail?.metacritic || listGame.metacritic || 0) || 0;
  const rawRating = Number(detail?.rating || listGame.rating || 0) || 0;
  const rating = metacritic || (rawRating ? Math.round(rawRating * 20) : 0);
  const ratingCount = Number(detail?.ratings_count || listGame.ratings_count || 0) || 0;
  const website = detail?.website || previous?.links?.official || '';
  const reddit = detail?.reddit_url || previous?.links?.reddit || '';
  const slug = detail?.slug || listGame.slug || previous?.slug || '';

  return {
    id: `rawg-${listGame.id}`,
    rawgId: listGame.id,
    sourceUpdated: listGame.updated || detail?.updated || null,
    name: listGame.name || detail?.name || previous?.name || 'Neznámá hra',
    slug,
    summary: rawDescription,
    storyline: '',
    cover,
    genres,
    developers,
    publishers,
    stores: storesFromDetail(detail),
    rating,
    ratingCount,
    igdbUrl: '',
    trailerId: '',
    links: {
      official: website,
      steam: previous?.links?.steam || '',
      epic: previous?.links?.epic || '',
      reddit,
      youtube: '',
      igdb: slug ? `https://rawg.io/games/${encodeURIComponent(slug)}` : 'https://rawg.io/'
    },
    releases
  };
}

function canReuse(previous, listGame) {
  if (!previous) return false;
  if (!previous.summary || !(previous.genres || []).length) return false;
  return previous.sourceUpdated && listGame.updated && String(previous.sourceUpdated) === String(listGame.updated);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function atomicWrite(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  console.log('🟢 Zdroj dat: RAWG (free plan)');
  const previousData = await loadPrevious();
  const platforms = await discoverPlatforms();
  const allowedPlatformIds = new Set(platforms.map(p => p.id));
  const { list, range } = await fetchGameList(platforms.map(p => p.id));

  let reused = 0;
  let detailed = 0;
  let detailFailures = 0;
  const games = await mapLimit(list, DETAIL_CONCURRENCY, async (listGame, index) => {
    const previous = previousData.byRawgId.get(Number(listGame.id));
    let detail = null;
    if (canReuse(previous, listGame)) {
      reused += 1;
    } else {
      try {
        detail = await rawg(`/games/${listGame.id}`);
        detailed += 1;
      } catch (error) {
        detailFailures += 1;
        console.warn(`⚠️ Detail ${listGame.name}: ${error.message}`);
      }
    }

    const fallbackPrevious = previous || {
      cover: previousData.coverByName.get(normalizeName(listGame.name)) || ''
    };
    const game = buildGame(listGame, detail, previous || fallbackPrevious, allowedPlatformIds);
    if (!game.releases.length) return null;
    if ((index + 1) % 100 === 0) console.log(`🔎 Zpracováno ${index + 1}/${list.length}`);
    return game;
  });

  const cleanGames = games.filter(Boolean).sort((a, b) =>
    (a.releases[0]?.date || '').localeCompare(b.releases[0]?.date || '') || a.name.localeCompare(b.name)
  );
  const allDates = cleanGames.flatMap(game => game.releases.map(r => r.date)).sort();
  const payload = {
    version: 3,
    provider: 'RAWG',
    generatedAt: new Date().toISOString(),
    range: allDates.length ? { from: allDates[0], to: allDates.at(-1) } : range,
    games: cleanGames
  };

  await atomicWrite(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  const releaseCount = cleanGames.reduce((sum, game) => sum + game.releases.length, 0);
  console.log(`✅ Uloženo ${cleanGames.length} her / ${releaseCount} datumů vydání do ${OUTPUT}`);
  console.log(`ℹ️ Detail RAWG: ${detailed} staženo, ${reused} použito z cache, ${detailFailures} selhalo.`);
}

main().catch(error => {
  console.error('❌ Aktualizace games.json selhala. Původní soubor zůstal zachovaný.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});