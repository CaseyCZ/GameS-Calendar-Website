#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { displayProducts, normalizeMicrosoftProduct, subscriptionKindsForIds } from '../src/providers/microsoft.js';
import { normalizeTitle, titleScore, uniq } from '../src/lib/normalize.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pad = value => String(value).padStart(2, '0');
const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const hit = [...args].find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};
const full = args.has('--full');
const force = args.has('--force');
const igdbOnly = args.has('--igdb-only');
const monthsBack = Math.max(0, Number(argValue('--months-back') || process.env.GAMES_CATALOG_MONTHS_BACK || 12));
const monthsForward = Math.max(1, Number(argValue('--months-forward') || process.env.GAMES_CATALOG_MONTHS_FORWARD || 24));
const storeLimit = full ? Number.POSITIVE_INFINITY : Math.max(0, Number(argValue('--store-limit') || process.env.GAMES_STORE_ENRICH_LIMIT || 1500));
const searchLimit = full ? Number.POSITIVE_INFINITY : Math.max(0, Number(argValue('--search-limit') || process.env.GAMES_SEARCH_ENRICH_LIMIT || 300));
const storeConcurrency = Math.max(1, Math.min(4, Number(process.env.GAMES_STORE_CONCURRENCY || 3)));
const runtimeFile = path.resolve(process.env.GAMES_RUNTIME_CATALOG_FILE || './data/catalog-runtime.json');

if (!config.igdbConfigured) {
  console.error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are required.');
  process.exit(2);
}

function dateOnly(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function rangeForNow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsForward + 1, 0));
  return { from: dateOnly(start), to: dateOnly(end) };
}

const range = rangeForNow();
const fromTs = Math.floor(Date.parse(`${range.from}T00:00:00Z`) / 1000);
const toTs = Math.floor(Date.parse(`${range.to}T23:59:59Z`) / 1000);

let tokenState = { token: '', expiresAt: 0 };
let nextIgdbAt = 0;

async function accessToken(forceRefresh = false) {
  if (!forceRefresh && tokenState.token && tokenState.expiresAt > Date.now() + 300_000) return tokenState.token;
  const body = new URLSearchParams({
    client_id: config.igdbClientId,
    client_secret: config.igdbClientSecret,
    grant_type: 'client_credentials'
  });
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json();
  if (!response.ok || !payload?.access_token) throw new Error(`Twitch token HTTP ${response.status}`);
  tokenState = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60_000, Number(payload.expires_in || 0) * 1000)
  };
  return tokenState.token;
}

async function igdb(endpoint, body, retry = 0) {
  const wait = Math.max(0, nextIgdbAt - Date.now());
  if (wait) await sleep(wait);
  nextIgdbAt = Date.now() + 285;
  const token = await accessToken();
  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': config.igdbClientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'content-type': 'text/plain'
    },
    body
  });
  const text = await response.text();
  if (response.status === 401 && retry < 1) {
    tokenState = { token: '', expiresAt: 0 };
    await accessToken(true);
    return igdb(endpoint, body, retry + 1);
  }
  if ((response.status === 429 || response.status >= 500) && retry < 4) {
    await sleep(1000 * (retry + 1));
    return igdb(endpoint, body, retry + 1);
  }
  if (!response.ok) throw new Error(`IGDB ${endpoint} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const GAME_FIELDS = [
  'id','name','slug','summary','storyline','first_release_date',
  'rating','rating_count','aggregated_rating','aggregated_rating_count','total_rating','total_rating_count',
  'game_type.type','genres.name','keywords.name','game_modes.name','player_perspectives.name','themes.name',
  'platforms.id','platforms.name','platforms.abbreviation','cover.image_id','artworks.image_id','screenshots.image_id',
  'videos.video_id','videos.name','alternative_names.name','collections.name','franchises.name',
  'involved_companies.company.name','involved_companies.developer','involved_companies.publisher',
  'external_games.uid','external_games.url','external_games.category','external_games.external_game_source.name',
  'websites.url'
].join(',');

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchReleaseRows() {
  const rows = [];
  let lastId = 0;
  for (;;) {
    const batch = await igdb('release_dates', `
      fields id,game,date,region,platform.id,platform.name,platform.abbreviation;
      where date >= ${fromTs} & date <= ${toTs} & id > ${lastId};
      sort id asc;
      limit 500;
    `);
    if (!batch.length) break;
    rows.push(...batch);
    lastId = batch.at(-1).id;
    if (rows.length % 5000 === 0) console.log(`IGDB release rows: ${rows.length}`);
    if (batch.length < 500) break;
  }
  return rows;
}

async function fetchGames(ids) {
  const result = new Map();
  let done = 0;
  for (const batch of chunks(ids, 200)) {
    const payload = await igdb('games', `fields ${GAME_FIELDS}; where id = (${batch.join(',')}); limit 500;`);
    for (const game of payload || []) result.set(String(game.id), game);
    done += batch.length;
    if (done % 2000 === 0 || done === ids.length) console.log(`IGDB game metadata: ${done}/${ids.length}`);
  }
  return result;
}

function imageUrl(id, size) {
  return id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : '';
}

function sourceName(item) {
  if (typeof item?.external_game_source?.name === 'string') return item.external_game_source.name;
  const known = {
    1: 'Steam', 5: 'GOG', 11: 'Microsoft', 26: 'Epic Games Store', 28: 'Oculus',
    31: 'Xbox Marketplace', 36: 'PlayStation Store US', 54: 'Xbox Game Pass Ultimate Cloud'
  };
  return known[Number(item?.category)] || '';
}

function parseExternalIds(game) {
  const out = {};
  for (const item of game.external_games || []) {
    const name = sourceName(item).toLowerCase();
    const value = String(item?.uid || '').trim();
    if (!value) continue;
    if (/steam/.test(name) && !out.steam) out.steam = value;
    else if (/playstation/.test(name) && !out.playstation) out.playstation = value;
    else if (/xbox.*cloud|game pass.*cloud/.test(name) && !out.xboxCloud) out.xboxCloud = value;
    else if (/xbox/.test(name) && !out.xbox) out.xbox = value;
    else if (/microsoft/.test(name) && !out.microsoft) out.microsoft = value;
    else if (/epic/.test(name) && !out.epic) out.epic = value;
    else if (/gog/.test(name) && !out.gog) out.gog = value;
  }

  for (const item of game.websites || []) {
    const raw = item?.url || '';
    let url;
    try { url = new URL(raw); } catch { continue; }
    const href = url.href;
    const steam = href.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (steam && !out.steam) out.steam = steam[1];
    const xbox = href.match(/(?:xbox\.com|apps\.microsoft\.com)\/[^?#]*\/([A-Z0-9]{10,16})(?:[/?#]|$)/i);
    if (xbox && !out.microsoft) out.microsoft = xbox[1].toUpperCase();
    const psProduct = href.match(/store\.playstation\.com\/[^?#]*\/product\/([^/?#]+)/i);
    if (psProduct && !out.playstationProduct) out.playstationProduct = decodeURIComponent(psProduct[1]);
    const psConcept = href.match(/store\.playstation\.com\/[^?#]*\/concept\/([^/?#]+)/i);
    if (psConcept && !out.playstationConcept) out.playstationConcept = decodeURIComponent(psConcept[1]);
    const nintendo = href.match(/\b(7\d{13})\b/);
    if (nintendo && !out.nintendo) out.nintendo = nintendo[1];
  }
  return out;
}

function websiteLinks(game, externalIds) {
  const links = { official: '', steam: '', epic: '', reddit: '', youtube: '', wikipedia: '', igdb: '' };
  for (const item of game.websites || []) {
    const raw = item?.url || '';
    if (!raw) continue;
    let host = '';
    try { host = new URL(raw).hostname.toLowerCase(); } catch {}
    if (/steampowered\.com/.test(host) && !links.steam) links.steam = raw;
    else if (/epicgames\.com/.test(host) && !links.epic) links.epic = raw;
    else if (/reddit\.com/.test(host) && !links.reddit) links.reddit = raw;
    else if (/youtube\.com|youtu\.be/.test(host) && !links.youtube) links.youtube = raw;
    else if (/wikipedia\.org/.test(host) && !links.wikipedia) links.wikipedia = raw;
    else if (!/igdb\.com|steam|playstation|xbox|microsoft|nintendo|epicgames|reddit|youtube|wikipedia/.test(host) && !links.official) links.official = raw;
  }
  if (!links.steam && externalIds.steam) links.steam = `https://store.steampowered.com/app/${externalIds.steam}/`;
  links.igdb = game.slug ? `https://www.igdb.com/games/${game.slug}` : '';
  return links;
}

function companies(game) {
  const developers = [];
  const publishers = [];
  for (const item of game.involved_companies || []) {
    const name = item?.company?.name;
    if (!name) continue;
    if (item.developer) developers.push(name);
    if (item.publisher) publishers.push(name);
  }
  return { developers: uniq(developers), publishers: uniq(publishers) };
}

function normalizeContentType(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (/main game|full game/.test(text) || text === 'game') return 'Plná hra';
  if (/dlc|addon|add-on/.test(text)) return 'DLC';
  if (/standalone expansion|expansion/.test(text)) return 'Rozšíření';
  if (/remake/.test(text)) return 'Remake';
  if (/remaster/.test(text)) return 'Remaster';
  if (/demo/.test(text)) return 'Demo';
  if (/mod/.test(text)) return 'Mod';
  return String(value || '').trim();
}

function inferScale(game, previous = {}) {
  if (previous.scale) return previous.scale;
  const labels = [
    ...(game.genres || []).map(item => item?.name),
    ...(game.keywords || []).map(item => item?.name),
    ...(game.themes || []).map(item => item?.name)
  ].filter(Boolean).join(' ').toLowerCase();
  if (/\bindie\b|independent/.test(labels)) return 'Indie';
  if (/\baaa\b|triple[- ]?a/.test(labels)) return 'AAA';
  return '';
}

function releaseMap(rows) {
  const byGame = new Map();
  for (const row of rows) {
    if (!row?.game || !row?.date) continue;
    const gameId = String(row.game);
    const day = new Date(Number(row.date) * 1000).toISOString().slice(0, 10);
    if (!byGame.has(gameId)) byGame.set(gameId, new Map());
    const byDay = byGame.get(gameId);
    if (!byDay.has(day)) byDay.set(day, { date: day, timestamp: Number(row.date), platforms: [], window: '', precision: 'day', regions: [] });
    const release = byDay.get(day);
    const platform = row.platform;
    if (platform?.name && !release.platforms.some(item => String(item.id) === String(platform.id) || item.name === platform.name)) {
      release.platforms.push({ id: platform.id ?? null, name: platform.name, abbreviation: platform.abbreviation || '' });
    }
    if (row.region != null && !release.regions.includes(row.region)) release.regions.push(row.region);
  }
  return new Map([...byGame].map(([gameId, days]) => [gameId, [...days.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}

function uniqueScreenshots(values) {
  const out = [];
  const seen = new Set();
  for (const item of values || []) {
    const full = typeof item === 'string' ? item : item?.full || item?.url || '';
    const thumb = typeof item === 'string' ? item : item?.thumb || full;
    if (!full || seen.has(full)) continue;
    seen.add(full);
    out.push({ full, thumb });
  }
  return out.slice(0, 24);
}

function makeCatalogGame(raw, releases, previous = {}) {
  const company = companies(raw);
  const externalIds = { ...(previous.externalIds || {}), ...parseExternalIds(raw) };
  const websites = (raw.websites || []).map(item => item?.url).filter(Boolean);
  const videos = (raw.videos || []).map(item => ({
    id: String(item?.video_id || ''),
    name: item?.name || '',
    url: item?.video_id ? `https://www.youtube.com/watch?v=${item.video_id}` : ''
  })).filter(item => item.id);
  const igdbScreens = (raw.screenshots || []).map(item => ({
    full: imageUrl(item?.image_id, 'screenshot_big_2x'),
    thumb: imageUrl(item?.image_id, 'screenshot_med')
  })).filter(item => item.full);
  const gameTypeRaw = raw.game_type?.type || raw.game_type || '';
  const genres = uniq([...(raw.genres || []).map(item => item?.name), ...(previous.genres || [])]);
  const rating = Number(raw.total_rating || raw.aggregated_rating || raw.rating || previous.rating || 0) || 0;
  const ratingCount = Number(raw.total_rating_count || raw.aggregated_rating_count || raw.rating_count || previous.ratingCount || 0) || 0;
  const links = { ...websiteLinks(raw, externalIds), ...(previous.links || {}) };
  for (const [key, value] of Object.entries(websiteLinks(raw, externalIds))) if (value) links[key] = value;
  const series = uniq([
    ...(raw.collections || []).map(item => item?.name),
    ...(raw.franchises || []).map(item => item?.name),
    ...(previous.series || [])
  ]);
  const contentType = normalizeContentType(gameTypeRaw) || previous.contentType || '';
  const earlyAccess = Boolean(previous.earlyAccess || /early access/i.test(String(gameTypeRaw)));

  return {
    ...previous,
    id: raw.id,
    name: raw.name || previous.name || 'Neznámá hra',
    slug: raw.slug || previous.slug || '',
    summary: raw.summary || previous.summary || raw.storyline || '',
    storyline: raw.storyline || previous.storyline || '',
    cover: imageUrl(raw.cover?.image_id, 'cover_big_2x') || previous.cover || '',
    genres,
    developers: uniq([...company.developers, ...(previous.developers || [])]),
    publishers: uniq([...company.publishers, ...(previous.publishers || [])]),
    rating,
    ratingCount,
    trailerId: videos[0]?.id || previous.trailerId || '',
    trailerUrl: videos[0]?.url || previous.trailerUrl || '',
    trailerPoster: previous.trailerPoster || '',
    links,
    releases,
    aliases: uniq([...(raw.alternative_names || []).map(item => item?.name), ...(previous.aliases || [])]),
    series,
    screenshots: uniqueScreenshots([...igdbScreens, ...(previous.screenshots || [])]),
    subscriptions: { ...(previous.subscriptions || {}) },
    regionalReleases: Array.isArray(previous.regionalReleases) ? previous.regionalReleases : [],
    scale: inferScale(raw, previous),
    contentType,
    earlyAccess,
    storeCategories: uniq(previous.storeCategories || []),
    metadataSources: uniq(['igdb', ...(previous.metadataSources || [])]),
    externalIds,
    providerIds: { ...(previous.providerIds || {}), igdb: String(raw.id) },
    providerChecks: { ...(previous.providerChecks || {}) },
    igdbUrl: links.igdb,
    metadataCheckedAt: new Date().toISOString(),
    metadataStatus: 'igdb',
    announcedWindow: previous.announcedWindow || '',
    gameModes: uniq([...(raw.game_modes || []).map(item => item?.name), ...(previous.gameModes || [])]),
    perspectives: uniq([...(raw.player_perspectives || []).map(item => item?.name), ...(previous.perspectives || [])]),
    themes: uniq([...(raw.themes || []).map(item => item?.name), ...(previous.themes || [])]),
    keywords: uniq([...(raw.keywords || []).map(item => item?.name), ...(previous.keywords || [])]),
    websites: uniq([...websites, ...(previous.websites || [])])
  };
}

function loadExisting() {
  const sqlite = readCatalog();
  if (sqlite?.games?.length) return sqlite;
  for (const file of [process.env.GAMES_BOOTSTRAP_CATALOG_FILE, '/var/www/games-calendar/games.json', new URL('../../games.json', import.meta.url)].filter(Boolean)) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(payload?.games)) return payload;
    } catch {}
  }
  return { games: [] };
}

function normalizeStoreRating(value) {
  const n = Number(value || 0);
  if (!n) return 0;
  if (n <= 5) return Math.round(n * 20 * 10) / 10;
  if (n <= 10) return Math.round(n * 10 * 10) / 10;
  return Math.round(n * 10) / 10;
}

function trailerFromUrl(url = '') {
  const youtube = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return youtube?.[1] || '';
}

function markCheck(game, provider, matched, detail = '') {
  game.providerChecks ||= {};
  game.providerChecks[provider] = { checkedAt: new Date().toISOString(), matched: Boolean(matched), detail: String(detail || '').slice(0, 160) };
}

function checkedRecently(game, provider, days = 14) {
  if (force) return false;
  const checked = Date.parse(game.providerChecks?.[provider]?.checkedAt || '');
  return Number.isFinite(checked) && Date.now() - checked < days * 86_400_000;
}

function applyCanonical(game, item, provider = item?.provider || '') {
  if (!game || !item) return false;
  if (!game.summary && (item.shortDescription || item.description)) game.summary = item.shortDescription || item.description;
  game.developers = uniq([...(game.developers || []), ...(item.developers || [])]);
  game.publishers = uniq([...(game.publishers || []), ...(item.publishers || [])]);
  game.genres = uniq([...(game.genres || []), ...(item.genres || [])]);
  game.storeCategories = uniq([...(game.storeCategories || []), ...(item.categories || [])]);
  game.metadataSources = uniq([...(game.metadataSources || []), provider].filter(Boolean));
  game.providerIds ||= {};
  if (provider && item.providerId) game.providerIds[provider] = String(item.providerId);
  if (!game.cover && item.media?.cover) game.cover = item.media.cover;
  game.screenshots = uniqueScreenshots([...(game.screenshots || []), ...(item.media?.screenshots || [])]);
  if (!game.trailerUrl && item.media?.trailers?.[0]) game.trailerUrl = item.media.trailers[0];
  if (!game.trailerId && game.trailerUrl) game.trailerId = trailerFromUrl(game.trailerUrl);
  const storeRating = normalizeStoreRating(item.rating);
  if (!game.rating && storeRating) {
    game.rating = storeRating;
    game.ratingCount = Number(item.ratingCount || 0) || game.ratingCount || 0;
    game.ratingSource = provider;
  }
  if (item.earlyAccess) game.earlyAccess = true;
  const type = normalizeContentType(item.gameType || item.rawHints?.type || item.rawHints?.gameType || '');
  if (!game.contentType && type) game.contentType = type;
  const scaleText = [...(item.genres || []), ...(item.categories || [])].join(' ').toLowerCase();
  if (!game.scale && /\bindie\b/.test(scaleText)) game.scale = 'Indie';
  game.subscriptions = { ...(game.subscriptions || {}), ...(item.subscriptions || {}) };
  if (item.externalIds) game.externalIds = { ...(game.externalIds || {}), ...item.externalIds };

  game.links ||= {};
  if (provider === 'steam' && item.storeUrl) game.links.steam = item.storeUrl;
  if (provider === 'microsoft' && item.storeUrl) game.links.xbox = item.storeUrl;
  if (provider === 'playstation' && item.storeUrl) game.links.playstation = item.storeUrl;
  if (provider === 'nintendo' && item.storeUrl) game.links.nintendo = item.storeUrl;
  if (provider === 'geforceNow' && item.storeUrl) game.links.geforceNow = item.storeUrl;
  return true;
}

async function steamReview(appId) {
  const url = new URL(`https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}`);
  url.searchParams.set('json', '1');
  url.searchParams.set('language', 'all');
  url.searchParams.set('purchase_type', 'all');
  url.searchParams.set('num_per_page', '0');
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent } });
  if (!response.ok) throw new Error(`Steam reviews HTTP ${response.status}`);
  const payload = await response.json();
  const q = payload?.query_summary || {};
  const total = Number(q.total_reviews || 0);
  const positive = Number(q.total_positive || 0);
  return { rating: total > 0 ? Math.round(positive / total * 1000) / 10 : 0, ratingCount: total };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const out = new Array(items.length);
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try { out[index] = await worker(items[index], index); }
      catch (error) { out[index] = { error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return out;
}

function exactIndex(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeTitle(item?.title || item?.name || '');
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

function gameNames(game) {
  return uniq([game.name, ...(game.aliases || [])]).map(normalizeTitle).filter(Boolean);
}

function matchExact(game, index) {
  for (const name of gameNames(game)) if (index.has(name)) return index.get(name);
  return null;
}

function hasPlatform(game, rx) {
  return (game.releases || []).some(release => (release.platforms || []).some(platform => rx.test(String(platform?.name || platform?.abbreviation || ''))));
}

async function bulkSubscriptionsAndGfn(games) {
  console.log('Bulk enrichment: Game Pass / cloud / GeForce NOW / PS Plus');

  const gamePassKinds = ['console', 'pc', 'cloud'];
  for (const kind of gamePassKinds) {
    try {
      const items = await providers.microsoft.gamePassCatalog(kind, { force, limit: 5000 });
      const index = exactIndex(items);
      const byId = new Map(items.map(item => [String(item.providerId || ''), item]));
      let matched = 0;
      for (const game of games) {
        const id = String(game.externalIds?.microsoft || game.externalIds?.xbox || '');
        const item = (id && byId.get(id)) || matchExact(game, index);
        if (!item) continue;
        applyCanonical(game, item, 'microsoft');
        matched++;
      }
      console.log(`  Game Pass ${kind}: ${matched} catalog matches`);
    } catch (error) {
      console.warn(`  Game Pass ${kind}: ${error.message}`);
    }
  }

  try {
    const items = await providers.geforceNow.list({ force, maxPages: 30 });
    const index = exactIndex(items);
    let matched = 0;
    for (const game of games) {
      const item = matchExact(game, index);
      if (!item) continue;
      applyCanonical(game, item, 'geforceNow');
      matched++;
    }
    console.log(`  GeForce NOW: ${matched} exact matches`);
  } catch (error) {
    console.warn(`  GeForce NOW: ${error.message}`);
  }

  const psPlusNames = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      for (const key of ['name','title','productName','conceptName']) {
        if (typeof value[key] === 'string' && value[key].trim().length > 1) psPlusNames.add(normalizeTitle(value[key]));
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  };
  for (const tier of ['TIER_10','TIER_20','TIER_30']) {
    try { walk(await providers.playstation.psPlus(tier, { force })); }
    catch (error) { console.warn(`  PS Plus ${tier}: ${error.message}`); }
  }
  let psMatched = 0;
  for (const game of games) {
    if (gameNames(game).some(name => psPlusNames.has(name))) {
      game.subscriptions ||= {};
      game.subscriptions.psPlus = true;
      psMatched++;
    }
  }
  console.log(`  PS Plus: ${psMatched} exact-title matches`);
}

function directNeeds(game, provider) {
  if (checkedRecently(game, provider)) return false;
  if (provider === 'steam') return Boolean(game.externalIds?.steam);
  if (provider === 'microsoft') return Boolean(game.externalIds?.microsoft || game.externalIds?.xbox);
  if (provider === 'playstation') return Boolean(game.externalIds?.playstationProduct || game.externalIds?.playstationConcept || game.externalIds?.playstation);
  if (provider === 'nintendo') return Boolean(game.externalIds?.nintendo);
  return false;
}

async function enrichDirect(games) {
  let budget = storeLimit;
  const queues = {
    steam: games.filter(game => directNeeds(game, 'steam')),
    microsoft: games.filter(game => directNeeds(game, 'microsoft')),
    playstation: games.filter(game => directNeeds(game, 'playstation')),
    nintendo: games.filter(game => directNeeds(game, 'nintendo'))
  };

  for (const provider of ['steam','microsoft','playstation','nintendo']) {
    if (budget <= 0) break;
    const queue = Number.isFinite(budget) ? queues[provider].slice(0, budget) : queues[provider];
    console.log(`Direct ${provider}: ${queue.length} games`);
    await mapLimit(queue, storeConcurrency, async game => {
      try {
        let item = null;
        if (provider === 'steam') {
          const id = String(game.externalIds.steam);
          item = await providers.steam.product(id, { force });
          applyCanonical(game, item, 'steam');
          try {
            const reviews = await steamReview(id);
            if (!game.rating && reviews.rating) {
              game.rating = reviews.rating;
              game.ratingCount = reviews.ratingCount;
              game.ratingSource = 'steam-reviews';
            }
          } catch {}
        } else if (provider === 'microsoft') {
          const id = String(game.externalIds.microsoft || game.externalIds.xbox);
          item = await providers.microsoft.product(id, { force });
          applyCanonical(game, item, 'microsoft');
        } else if (provider === 'playstation') {
          const ids = game.externalIds || {};
          const generic = String(ids.playstation || '');
          if (ids.playstationProduct) item = await providers.playstation.product(String(ids.playstationProduct), { force });
          else if (ids.playstationConcept) item = await providers.playstation.concept(String(ids.playstationConcept), { force });
          else if (/^(?:UP|EP|JP|HP|PP|CUSA|PPSA)/i.test(generic)) item = await providers.playstation.product(generic, { force });
          else if (/^\d+$/.test(generic)) item = await providers.playstation.concept(generic, { force });
          if (item) applyCanonical(game, item, 'playstation');
        } else if (provider === 'nintendo') {
          item = await providers.nintendo.productById(String(game.externalIds.nintendo), { force });
          applyCanonical(game, item, 'nintendo');
        }
        markCheck(game, provider, Boolean(item));
      } catch (error) {
        markCheck(game, provider, false, error.message);
      }
      await sleep(90);
    });
    if (Number.isFinite(budget)) budget -= queue.length;
  }
}

function criticalMissing(game) {
  return !game.summary || !game.cover || !(game.genres || []).length || !(game.developers || []).length || !(game.publishers || []).length;
}

async function enrichSearchFallback(games) {
  if (!searchLimit) return;
  const candidates = games.filter(criticalMissing);
  let used = 0;
  for (const game of candidates) {
    if (used >= searchLimit) break;
    const jobs = [];
    if (hasPlatform(game, /PC|Windows|Linux|Mac/i) && !checkedRecently(game, 'steam-search')) jobs.push(['steam', providers.steam]);
    if (hasPlatform(game, /Xbox/i) && !checkedRecently(game, 'microsoft-search')) jobs.push(['microsoft', providers.microsoft]);
    if (hasPlatform(game, /PlayStation|PS[45]/i) && !checkedRecently(game, 'playstation-search')) jobs.push(['playstation', providers.playstation]);
    if (hasPlatform(game, /Nintendo Switch/i) && !checkedRecently(game, 'nintendo-search')) jobs.push(['nintendo', providers.nintendo]);
    for (const [name, provider] of jobs) {
      if (used >= searchLimit) break;
      used++;
      try {
        const hits = await provider.search(game.name, { force, limit: 3 });
        const ranked = (hits || []).map(item => ({ item, score: titleScore(game.name, item?.title) })).sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (best?.item && best.score >= (name === 'nintendo' ? 0.62 : 0.72)) {
          applyCanonical(game, best.item, name);
          markCheck(game, `${name}-search`, true, `score=${best.score.toFixed(2)}`);
        } else markCheck(game, `${name}-search`, false, best ? `score=${best.score.toFixed(2)}` : 'no hit');
      } catch (error) {
        markCheck(game, `${name}-search`, false, error.message);
      }
      await sleep(120);
    }
  }
  console.log(`Fallback storefront searches: ${used}`);
}

function coverage(games) {
  const count = fn => games.reduce((sum, game) => sum + (fn(game) ? 1 : 0), 0);
  return {
    games: games.length,
    genres: count(game => game.genres?.length),
    developers: count(game => game.developers?.length),
    publishers: count(game => game.publishers?.length),
    series: count(game => game.series?.length),
    scale: count(game => game.scale),
    contentType: count(game => game.contentType),
    earlyAccess: count(game => game.earlyAccess),
    screenshots: count(game => game.screenshots?.length),
    trailer: count(game => game.trailerId || game.trailerUrl),
    rating: count(game => Number(game.rating || 0) > 0),
    description: count(game => game.summary || game.storyline),
    gamePass: count(game => game.subscriptions?.gamePass || game.subscriptions?.gamePassConsole || game.subscriptions?.gamePassPc),
    cloudGaming: count(game => game.subscriptions?.cloudGaming),
    psPlus: count(game => game.subscriptions?.psPlus),
    geforceNow: count(game => game.subscriptions?.geforceNow)
  };
}

function writeRuntime(payload) {
  fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
  const tmp = `${runtimeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, runtimeFile);
}

function persist(games, stage) {
  const payload = {
    version: 7,
    provider: 'igdb+official-stores',
    generatedAt: new Date().toISOString(),
    range,
    games,
    sync: { stage, monthsBack, monthsForward, full, igdbOnly, coverage: coverage(games) }
  };
  replaceCatalog(payload, { source: `sync:${stage}`, sourceMtime: Date.now() });
  const stored = readCatalog() || payload;
  writeRuntime(stored);
  console.log(`Saved ${games.length} games (${stage}) -> SQLite + ${runtimeFile}`);
  return stored;
}

console.log(`Catalog range: ${range.from} -> ${range.to}`);
console.log(`Mode: ${igdbOnly ? 'IGDB only' : full ? 'FULL enrichment' : `incremental (store limit ${storeLimit}, search limit ${searchLimit})`}`);

const previousPayload = loadExisting();
const previousById = new Map((previousPayload.games || []).map(game => [String(game.id), game]));
const releaseRows = await fetchReleaseRows();
const releasesByGame = releaseMap(releaseRows);
const ids = [...new Set(releaseRows.map(row => String(row.game || '')).filter(Boolean))];
console.log(`IGDB release rows=${releaseRows.length}, unique games=${ids.length}`);
const rawGames = await fetchGames(ids);

const games = [];
for (const id of ids) {
  const raw = rawGames.get(id);
  const releases = releasesByGame.get(id) || [];
  if (!raw || !releases.length) continue;
  games.push(makeCatalogGame(raw, releases, previousById.get(id) || {}));
}
games.sort((a, b) => {
  const ad = a.releases?.[0]?.date || '9999-12-31';
  const bd = b.releases?.[0]?.date || '9999-12-31';
  return ad.localeCompare(bd) || String(a.name).localeCompare(String(b.name), 'cs');
});

persist(games, 'igdb');

if (!igdbOnly) {
  await bulkSubscriptionsAndGfn(games);
  persist(games, 'bulk-services');
  await enrichDirect(games);
  persist(games, 'direct-stores');
  await enrichSearchFallback(games);
  persist(games, 'complete');
}

console.log('\n=== COVERAGE ===');
const stats = coverage(games);
for (const [key, value] of Object.entries(stats)) console.log(`${key} = ${value}`);
console.log(`\nDone. API version ${config.version}. Public /var/www/games-calendar/games.json was NOT overwritten.`);
