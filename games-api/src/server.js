import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import webpush from 'web-push';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { config } from './config.js';
import {
  getDiscoveredGame,
  historyStartedAt,
  historyForGame,
  latestChangeId,
  listRecentChanges,
  listPushSubscriptions,
  markPushDelivered,
  prunePushDeliveries,
  removePushSubscription,
  listHealth,
  saveDiscoveredGame,
  saveGameSnapshot,
  saveHealth,
  savePushSubscription,
  searchDiscoveredGames,
  syncCatalogGames,
  wasPushDelivered
} from './db.js';
import { mergeGames, normalizeTitle, storefrontTitleScore, titleQueryVariants, titleScore } from './lib/normalize.js';
import { buildCalendarFeed } from './lib/calendar.js';
import { providers, providerList } from './providers/index.js';

const app = express();
const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
if (pushEnabled) webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
// Only the local Nginx proxy may supply the client address.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));
const corsOrigins = new Set(config.corsOrigins || []);
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Accept'],
  maxAge: 86_400
}));
app.use(express.json({ limit: '1mb' }));

const rateBuckets = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${minute}`;
  const used = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, used);
  if (rateBuckets.size > 5000) {
    for (const bucket of rateBuckets.keys()) {
      const bucketMinute = Number(bucket.slice(bucket.lastIndexOf(':') + 1));
      if (bucketMinute < minute - 1) rateBuckets.delete(bucket);
    }
  }
  res.setHeader('X-RateLimit-Limit', String(config.rateLimitPerMinute));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, config.rateLimitPerMinute - used)));
  if (used > config.rateLimitPerMinute) return res.status(429).json({ error: 'Rate limit exceeded' });
  next();
});

const expensiveRateBuckets = new Map();
function expensiveRateLimit(limit = 30) {
  return (req, res, next) => {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${minute}`;
    const used = (expensiveRateBuckets.get(key) || 0) + 1;
    expensiveRateBuckets.set(key, used);
    if (expensiveRateBuckets.size > 5000) {
      for (const bucket of expensiveRateBuckets.keys()) {
        const bucketMinute = Number(bucket.slice(bucket.lastIndexOf(':') + 1));
        if (bucketMinute < minute - 1) expensiveRateBuckets.delete(bucket);
      }
    }
    if (used > limit) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Expensive API rate limit exceeded' });
    }
    next();
  };
}

app.use('/api/enrich', expensiveRateLimit(30));
app.use('/api/search', expensiveRateLimit(60));
app.use('/api/discover', expensiveRateLimit(45));
app.use('/api/igdb/catalog-batch', expensiveRateLimit(12));
app.use('/api/igdb/catalog-range', expensiveRateLimit(90));

const asyncRoute = handler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) { next(error); }
};

function bool(value) {
  return value === true || value === '1' || value === 'true';
}

function limitOf(value, fallback = 8, max = 50) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

const CATALOG_FILES = [
  process.env.GAMES_CATALOG_FILE,
  '/var/www/games-calendar/games.json',
  new URL('../../games.json', import.meta.url)
].filter(Boolean);

const PRICE_KEYS = new Set([
  'price', 'prices', 'currency', 'discount', 'discountPercent',
  'regularPrice', 'salePrice', 'msrp', 'formattedPrice'
]);

function stripPricing(value) {
  if (Array.isArray(value)) return value.map(stripPricing);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRICE_KEYS.has(key))
      .map(([key, nested]) => [key, stripPricing(nested)])
  );
}

function compactGame(game = {}) {
  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    aliases: game.aliases,
    cover: game.cover,
    genres: game.genres,
    developers: game.developers,
    publishers: game.publishers,
    series: game.series,
    scale: game.scale,
    contentType: game.contentType,
    earlyAccess: game.earlyAccess,
    storeCategories: game.storeCategories,
    metadataSources: game.metadataSources,
    steamId: game.steamId,
    rating: game.rating,
    ratingCount: game.ratingCount,
    igdbUrl: game.igdbUrl,
    trailerId: game.trailerId,
    trailerUrl: game.trailerUrl,
    subscriptions: game.subscriptions,
    announcedWindow: game.announcedWindow,
    releases: game.releases,
    hasScreenshots: Boolean(game.screenshots?.length),
    hasDescription: Boolean(String(game.summary || game.storyline || '').trim())
  };
}

function igdbContentType(value) {
  const type = String(value || '').toLowerCase().replace(/_/g, ' ');
  const labels = {
    'main game': 'Main game',
    'dlc addon': 'DLC / Add-on',
    expansion: 'Expansion',
    bundle: 'Bundle',
    remake: 'Remake',
    remaster: 'Remaster',
    port: 'Port',
    'standalone expansion': 'Standalone expansion',
    'expanded game': 'Expanded game',
    season: 'Season',
    mod: 'Mod',
    episode: 'Episode'
  };
  return labels[type] || (type ? type.replace(/\b\w/g, letter => letter.toUpperCase()) : 'Game');
}

function providerLabel(name = '') {
  return {
    igdb: 'IGDB',
    steam: 'Steam',
    epic: 'Epic Games',
    microsoft: 'Xbox',
    playstation: 'PlayStation',
    nintendo: 'Nintendo',
    geforceNow: 'GeForce NOW'
  }[name] || name;
}

function providerLinkKey(name = '') {
  return {
    steam: 'steam',
    epic: 'epic',
    microsoft: 'xbox',
    playstation: 'playstation',
    nintendo: 'nintendo',
    geforceNow: 'geforceNow',
    igdb: 'igdb'
  }[name] || '';
}

function catalogGameFromProviders(items = []) {
  const valid = (items || []).filter(item => item?.title);
  const merged = mergeGames(valid);
  if (!merged?.title) return null;

  const providersByName = merged.providers || {};
  const links = {};
  for (const [provider, item] of Object.entries(providersByName)) {
    const key = providerLinkKey(provider);
    if (key && item?.storeUrl) links[key] = item.storeUrl;
  }

  const byDate = new Map();
  for (const item of valid) {
    const day = String(item.releaseDate || '').slice(0, 10);
    if (!day) continue;
    if (!byDate.has(day)) byDate.set(day, { day, platforms: new Set() });
    for (const platform of item.platforms || []) byDate.get(day).platforms.add(String(platform));
  }

  const releases = [...byDate.values()].map(release => ({
    day: release.day,
    timestamp: Math.floor(Date.parse(`${release.day}T00:00:00Z`) / 1000),
    platforms: [...release.platforms].map(name => ({ name, abbreviation: name })),
    window: '',
    precision: 'day',
    precisionSource: 'store-provider-date',
    regions: []
  }));

  if (!releases.length) {
    releases.push({
      day: null,
      timestamp: 0,
      platforms: (merged.platforms || []).map(name => ({ name, abbreviation: name })),
      window: 'TBA',
      precision: 'unknown',
      precisionSource: 'store-provider-inferred',
      regions: []
    });
  }

  const normalized = normalizeTitle(merged.title);
  const id = `store-${normalized.replace(/\s+/g, '-') || 'game'}`;
  const sourceNames = Object.keys(providersByName).map(providerLabel);
  const primaryProvider = valid[0]?.provider || '';
  const primary = providersByName[primaryProvider] || valid[0];

  return stripPricing({
    id,
    name: merged.title,
    slug: id,
    aliases: merged.aliases || [],
    summary: merged.description || merged.shortDescription || '',
    summarySource: providerLabel(merged.fieldSources?.description || merged.fieldSources?.shortDescription || primaryProvider),
    cover: merged.media?.cover || '',
    screenshots: merged.media?.screenshots || [],
    genres: merged.genres || [],
    developers: merged.developers || [],
    publishers: merged.publishers || [],
    series: merged.series || [],
    contentType: 'Game',
    earlyAccess: Boolean(providersByName.steam?.earlyAccess),
    metadataSources: sourceNames,
    steamId: providersByName.steam?.providerId ? String(providersByName.steam.providerId) : '',
    rating: merged.rating || primary?.rating || 0,
    ratingCount: primary?.ratingCount || 0,
    subscriptions: merged.subscriptions || {},
    links,
    releases,
    discoveredOnline: true,
    discoveredAt: new Date().toISOString()
  });
}

function catalogGameFromIgdb(item) {
  const byDate = new Map();
  for (const release of item?.releaseDates || []) {
    const day = String(release?.day || '').slice(0, 10);
    const window = String(release?.window || '').trim();
    if (!day && !window) continue;
    const precision = release?.precision || (day ? 'day' : 'unknown');
    const key = `${day || window}|${precision}`;
    if (!byDate.has(key)) byDate.set(key, {
      day: day || null,
      window,
      precision,
      precisionSource: release?.precisionSource || '',
      platforms: new Set()
    });
    if (release.platform) byDate.get(key).platforms.add(String(release.platform));
  }
  if (!byDate.size && item?.releaseDate) {
    const day = String(item.releaseDate).slice(0, 10);
    byDate.set(`${day}|day`, { day, window: '', precision: 'day', platforms: new Set(item.platforms || []) });
  }
  const releases = [...byDate.values()].map(release => ({
    day: release.day,
    timestamp: release.day ? Math.floor(Date.parse(`${release.day}T00:00:00Z`) / 1000) : 0,
    platforms: [...release.platforms].map(name => ({ name, abbreviation: name })),
    window: release.window,
    precision: release.precision,
    precisionSource: release.precisionSource || 'igdb-inferred',
    regions: []
  }));
  if (!releases.length) {
    releases.push({
      day: null,
      timestamp: 0,
      platforms: (item?.platforms || []).map(name => ({ name, abbreviation: name })),
      window: 'TBA',
      precision: 'unknown',
      precisionSource: 'igdb-inferred',
      regions: []
    });
  }
  const websites = item?.websites || item?.rawHints?.websites || [];
  const official = websites.find(url => !/(igdb\.com|steam|xbox|playstation|wikipedia|youtube|reddit)/i.test(url)) || '';
  const video = item?.videos?.[0] || item?.rawHints?.videos?.[0] || null;
  return stripPricing({
    id: `igdb-${item.providerId}`,
    igdbId: String(item.providerId),
    name: item.title,
    slug: `igdb-${item.providerId}`,
    aliases: item.aliases || item.rawHints?.aliases || [],
    summary: item.description || item.shortDescription || '',
    summarySource: 'IGDB',
    cover: item.media?.cover || '',
    screenshots: item.media?.screenshots || [],
    genres: item.genres || [],
    developers: item.developers || [],
    publishers: item.publishers || [],
    series: item.series || [],
    contentType: igdbContentType(item.gameType || item.rawHints?.gameType),
    metadataSources: ['IGDB'],
    rating: item.rating || 0,
    ratingCount: item.ratingCount || 0,
    igdbUrl: item.storeUrl || '',
    trailerId: video?.id || '',
    trailerUrl: video?.url || item.media?.trailers?.[0] || '',
    links: { official, igdb: item.storeUrl || '' },
    releases,
    discoveredOnline: true,
    discoveredAt: new Date().toISOString()
  });
}

function responseDocument(payload) {
  const body = JSON.stringify(payload);
  return { body, etag: `"${createHash('sha256').update(body).digest('base64url')}"` };
}

function requestMatchesEtag(req, etag) {
  const expected = etag.replace(/^W\//, '');
  return String(req.headers['if-none-match'] || '')
    .split(/\s*,\s*/)
    .map(value => value.replace(/^W\//, ''))
    .includes(expected);
}

let catalogCache = null;

async function readCatalog() {
  const errors = [];
  for (const file of CATALOG_FILES) {
    try {
      const info = await stat(file);
      const cacheKey = `${String(file)}:${info.size}:${info.mtimeMs}`;
      if (catalogCache?.key === cacheKey) return catalogCache;

      const sourcePayload = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(sourcePayload) && !Array.isArray(sourcePayload?.games)) {
        throw new Error('catalog has no games array');
      }
      const cleaned = stripPricing(sourcePayload);
      const payload = Array.isArray(cleaned)
        ? cleaned
        : { ...cleaned, apiVersion: config.version, source: 'games-api-catalog' };
      const full = responseDocument(payload);
      const listPayload = Array.isArray(payload) ? payload : {
        version: payload.version,
        provider: payload.provider,
        generatedAt: payload.generatedAt,
        range: payload.range,
        apiVersion: config.version,
        source: 'games-api-catalog-list',
        games: payload.games.map(compactGame)
      };
      const list = responseDocument(listPayload);
      const games = Array.isArray(payload) ? payload : payload.games;
      syncCatalogGames(games, { fingerprint: cacheKey, source: payload.generatedAt || 'catalog' });
      catalogCache = {
        key: cacheKey,
        payload,
        full,
        list,
        gameById: new Map(games.flatMap(game => [
          [String(game.id), game],
          game.slug ? [String(game.slug), game] : null
        ].filter(Boolean))),
        meta: {
          version: Array.isArray(payload) ? 1 : (payload.version || 1),
          apiVersion: config.version,
          generatedAt: Array.isArray(payload) ? null : (payload.generatedAt || null),
          count: games.length,
          bytes: Buffer.byteLength(full.body),
          listBytes: Buffer.byteLength(list.body),
          source: 'games-api-catalog'
        }
      };
      return catalogCache;
    } catch (error) {
      errors.push(`${String(file)}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`Game catalog unavailable: ${errors.join(' | ')}`);
}

async function providerHealth(provider) {
  const started = Date.now();
  try {
    const result = await provider.health();
    const ok = result?.ok !== false;
    saveHealth(provider.name, ok, ok ? 'ok' : 'failed', JSON.stringify({ ...result, durationMs: Date.now() - started }));
    return { provider: provider.name, ...result, durationMs: Date.now() - started };
  } catch (error) {
    saveHealth(provider.name, false, 'error', error?.message || String(error));
    return { provider: provider.name, ok: false, error: error?.message || String(error), durationMs: Date.now() - started };
  }
}

async function bestSearchHit(provider, title, { force = false } = {}) {
  if (typeof provider.search !== 'function') return null;
  const queries = titleQueryVariants(title);
  const results = await Promise.allSettled(
    queries.map(query => provider.search(query, { force, limit: 5 }))
  );
  const unique = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value || []) {
      const key = `${item?.provider || provider.name}:${item?.providerId || normalizeTitle(item?.title || '')}`;
      if (!unique.has(key)) unique.set(key, item);
    }
  }
  return [...unique.values()]
    .map(item => ({
      item,
      score: titleScore(title, item?.title),
      storefrontScore: storefrontTitleScore(title, item?.title)
    }))
    .sort((a, b) => b.storefrontScore - a.storefrontScore || b.score - a.score)[0] || null;
}

function addFound(found, item) {
  if (!item?.provider) return;
  const index = found.findIndex(entry => entry?.provider === item.provider);
  if (index >= 0) found[index] = item;
  else found.push(item);
}

function selectedNames(providerNames) {
  return new Set(providerList(providerNames).map(provider => provider.name));
}

function psIdentity(ids = {}) {
  const explicitProduct = ids.playstationProduct || '';
  const explicitConcept = ids.playstationConcept || '';
  const generic = ids.playstation || '';
  if (explicitProduct) return { product: explicitProduct };
  if (explicitConcept) return { concept: explicitConcept };
  if (/^(?:UP|EP|JP|HP|PP|CUSA|PPSA)/i.test(generic)) return { product: generic };
  if (/^\d+$/.test(generic)) return { concept: generic };
  return {};
}

async function resolveIgdbIdentity(game, title, { force = false } = {}) {
  if (!providers.igdb) return null;
  if (game.igdbId) {
    try { return await providers.igdb.product(String(game.igdbId), { force }); }
    catch {}
  }
  if (!title) return null;
  try {
    const hit = await bestSearchHit(providers.igdb, title, { force });
    if (hit?.item && hit.score >= 0.62) return hit.item;
  } catch {}
  return null;
}

async function directFromIdentity(identity, wanted, { force = false } = {}) {
  if (!identity) return [];
  const ids = identity.externalIds || identity.rawHints?.externalIds || {};
  const jobs = [];

  if (wanted.has('steam') && providers.steam && ids.steam) {
    jobs.push(providers.steam.product(String(ids.steam), { force }));
  }

  const microsoftId = ids.microsoft || ids.xbox;
  if (wanted.has('microsoft') && providers.microsoft && microsoftId) {
    jobs.push(providers.microsoft.product(String(microsoftId), { force }));
  }

  if (wanted.has('playstation') && providers.playstation) {
    const ps = psIdentity(ids);
    if (ps.product) jobs.push(providers.playstation.product(String(ps.product), { force }));
    else if (ps.concept) jobs.push(providers.playstation.concept(String(ps.concept), { force }));
  }

  const out = [];
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === 'fulfilled' && result.value) out.push(result.value);
  }
  return out;
}

async function enrichOne(input, { force = false, providerNames } = {}) {
  const game = typeof input === 'string' ? { title: input } : (input || {});
  const title = String(game.title || game.name || '').trim();
  const found = [];
  const wanted = selectedNames(providerNames);

  const direct = [
    game.steamId && providers.steam?.product(String(game.steamId), { force }),
    game.xboxProductId && providers.microsoft?.product(String(game.xboxProductId), { force }),
    game.microsoftProductId && providers.microsoft?.product(String(game.microsoftProductId), { force }),
    game.psProductId && providers.playstation?.product(String(game.psProductId), { force }),
    game.psConceptId && providers.playstation?.concept(String(game.psConceptId), { force }),
    game.nintendoUrl && providers.nintendo?.productByUrl(String(game.nintendoUrl), { force }),
    game.nintendoTitleId && providers.nintendo?.productById(String(game.nintendoTitleId), { force })
  ].filter(Boolean);

  for (const result of await Promise.allSettled(direct)) {
    if (result.status === 'fulfilled' && result.value) addFound(found, result.value);
  }

  const igdbIdentity = await resolveIgdbIdentity(game, title, { force });
  if (igdbIdentity) {
    addFound(found, igdbIdentity);
    const directStoreResults = await directFromIdentity(igdbIdentity, wanted, { force });
    directStoreResults.forEach(item => addFound(found, item));
  }

  if (title) {
    const selected = providerList(providerNames)
      .filter(provider => provider.name !== 'igdb')
      .filter(provider => typeof provider.search === 'function')
      .filter(provider => !found.some(item => item.provider === provider.name));
    const searched = await Promise.allSettled(selected.map(provider => bestSearchHit(provider, title, { force })));
    for (const result of searched) {
      if (result.status !== 'fulfilled' || !result.value?.item) continue;
      const threshold = result.value.item.provider === 'nintendo' ? 0.55 : 0.48;
      if (result.value.score >= threshold) addFound(found, result.value.item);
    }
  }

  const merged = mergeGames(found);
  const gameKey = String(game.id || game.slug || normalizeTitle(title || merged?.title || '')).trim();
  const changes = merged && gameKey ? saveGameSnapshot(gameKey, merged, 'live-enrich') : [];
  return {
    query: game,
    gameKey,
    identity: igdbIdentity ? {
      igdbId: igdbIdentity.providerId,
      externalIds: igdbIdentity.externalIds || igdbIdentity.rawHints?.externalIds || {}
    } : null,
    matchedProviders: found.map(item => item.provider),
    merged,
    changes,
    providers: Object.fromEntries(found.map(item => [item.provider, item]))
  };
}

app.get('/', (req, res) => {
  res.json({
    name: 'GameS Calendar API',
    version: config.version,
    market: config.market,
    language: config.language,
    providers: Object.values(providers).map(provider => ({ name: provider.name, capabilities: provider.capabilities }))
  });
});

app.get('/health', asyncRoute(async (req, res) => {
  if (!bool(req.query.refresh)) return res.json({ ok: true, version: config.version, cached: listHealth() });
  const results = await Promise.all(Object.values(providers).map(providerHealth));
  res.status(results.every(item => item.ok) ? 200 : 207).json({ ok: results.every(item => item.ok), version: config.version, results });
}));

app.get('/api/catalog-meta', asyncRoute(async (req, res) => {
  const catalog = await readCatalog();
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(catalog.meta);
}));

app.get('/api/catalog', asyncRoute(async (req, res) => {
  const catalog = await readCatalog();
  const document = req.query.view === 'list' ? catalog.list : catalog.full;
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.setHeader('ETag', document.etag);
  if (requestMatchesEtag(req, document.etag)) return res.status(304).end();
  res.type('application/json').send(document.body);
}));

app.get('/api/catalog/game/:gameId', asyncRoute(async (req, res) => {
  const catalog = await readCatalog();
  const game = catalog.gameById.get(String(req.params.gameId)) || getDiscoveredGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.json(game);
}));

app.get('/api/calendar.ics', asyncRoute(async (req, res) => {
  const catalog = await readCatalog();
  const catalogGames = Array.isArray(catalog.payload) ? catalog.payload : catalog.payload.games;
  const ids = String(req.query.ids || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 500);
  const gameMap = new Map(catalogGames.map(game => [String(game.id), game]));
  for (const id of ids) {
    if (!gameMap.has(id)) {
      const discovered = getDiscoveredGame(id);
      if (discovered) gameMap.set(id, discovered);
    }
  }
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProtocol === 'https' ? 'https' : req.protocol;
  const result = buildCalendarFeed([...gameMap.values()], {
    ids,
    platforms: req.query.platforms,
    genres: req.query.genres,
    developer: req.query.developer,
    publisher: req.query.publisher,
    series: req.query.series,
    status: req.query.status,
    from: req.query.from,
    to: req.query.to,
    generatedAt: catalog.meta.generatedAt,
    webBaseUrl: `${protocol}://${req.get('host')}/games`,
    name: ids.length ? 'Herní Kalendář – sledované hry' : 'Herní Kalendář – vlastní výběr'
  });
  const etag = `"${createHash('sha256').update(result.body).digest('base64url')}"`;
  res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
  res.setHeader('ETag', etag);
  res.setHeader('X-Calendar-Events', String(result.count));
  res.setHeader('Content-Disposition', 'inline; filename="herni-kalendar.ics"');
  if (requestMatchesEtag(req, etag)) return res.status(304).end();
  res.type('text/calendar; charset=utf-8').send(result.body);
}));

app.get('/api/changes', asyncRoute(async (req, res) => {
  await readCatalog();
  const days = Math.max(1, Math.min(3650, Number(req.query.days) || 30));
  const explicitSince = Date.parse(String(req.query.since || ''));
  const since = Number.isFinite(explicitSince) ? explicitSince : Date.now() - days * 86_400_000;
  const type = ['all', 'new', 'date', 'price', 'subscription', 'early'].includes(String(req.query.type)) ? String(req.query.type) : 'all';
  const items = listRecentChanges({ limit: limitOf(req.query.limit, 100, 500), since, type });
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ count: items.length, type, since: new Date(since).toISOString(), trackingSince: historyStartedAt(), items });
}));

app.get('/api/push/public-key', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? config.vapidPublicKey : '' });
});

app.post('/api/push/subscribe', asyncRoute(async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'Push notifications are not configured' });
  const subscription = req.body?.subscription;
  let endpoint;
  try { endpoint = new URL(String(subscription?.endpoint || '')); }
  catch { return res.status(400).json({ error: 'Invalid push endpoint' }); }
  if (endpoint.protocol !== 'https:') return res.status(400).json({ error: 'Push endpoint must use HTTPS' });
  const result = savePushSubscription(subscription, req.body?.gameIds);
  res.status(201).json({ ok: true, gameCount: result.gameCount, latestChangeId: latestChangeId() });
}));

app.delete('/api/push/subscribe', (req, res) => {
  removePushSubscription(req.body?.endpoint);
  res.json({ ok: true });
});

function titleMatchesQuery(query, title) {
  const words = normalizeTitle(query).split(' ').filter(Boolean);
  const name = normalizeTitle(title);
  return words.length > 0 && words.every(word => name.includes(word));
}

function discoveryIdentity(game = {}) {
  if (game.igdbId) return `igdb:${game.igdbId}`;
  const firstRelease = (game.releases || [])
    .map(release => release.day || release.date || '')
    .filter(Boolean)
    .sort()[0] || '';
  const year = firstRelease.slice(0, 4);
  return `title:${normalizeTitle(game.name)}:${year}`;
}

function discoveryScore(query, game) {
  const q = normalizeTitle(query);
  const name = normalizeTitle(game?.name);
  const contentType = String(game?.contentType || '').toLowerCase();
  let score = name === q ? 1000 : name.startsWith(q) ? 800 : name.includes(q) ? 600 : titleScore(q, name) * 500;
  if (contentType === 'main game') score += 120;
  else if (['remake', 'remaster', 'expanded game', 'standalone expansion'].includes(contentType)) score += 70;
  score += Math.min(99, Math.log10(Math.max(1, Number(game?.ratingCount || 0))) * 20);
  return score;
}

app.get('/api/discover', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.status(400).json({ error: 'Search must have at least 2 characters' });

  const limit = limitOf(req.query.limit, 500, 500);
  const providerLimit = Math.min(20, Math.max(8, limit));
  const nameSearchLimit = 500;
  const catalog = await readCatalog();
  const catalogGames = Array.isArray(catalog.payload) ? catalog.payload : catalog.payload.games;
  const catalogIgdbIds = new Set(catalogGames.map(game => String(game.igdbId || '')).filter(Boolean));
  const catalogTitles = new Set(
    catalogGames
      .flatMap(game => [game.name, ...(game.aliases || [])])
      .map(normalizeTitle)
      .filter(Boolean)
  );

  const saved = searchDiscoveredGames(q, nameSearchLimit)
    .filter(game => !game.igdbId
      ? !catalogTitles.has(normalizeTitle(game.name))
      : !catalogIgdbIds.has(String(game.igdbId)));

  const searches = [];
  if (providers.igdb) {
    searches.push(
      ['igdb', providers.igdb.search(q, { limit: providerLimit })],
      ['igdb-name', providers.igdb.searchByName(q, { limit: nameSearchLimit })],
      ['igdb-words', providers.igdb.searchByWords(q, { limit: nameSearchLimit })]
    );
  }
  if (providers.steam) searches.push(['steam', providers.steam.search(q, { limit: providerLimit })]);
  if (providers.microsoft) searches.push(['microsoft', providers.microsoft.search(q, { limit: providerLimit })]);
  if (providers.playstation) searches.push(['playstation', providers.playstation.search(q, { limit: providerLimit })]);
  if (providers.nintendo) searches.push(['nintendo', providers.nintendo.search(q, { limit: providerLimit })]);
  if (providers.geforceNow) searches.push(['geforceNow', providers.geforceNow.search(q, { limit: providerLimit })]);

  const settled = await Promise.allSettled(searches.map(([, promise]) => promise));
  const providerHits = new Map();
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const providerName = searches[index][0];
    if (result.status !== 'fulfilled') continue;
    providerHits.set(providerName, result.value || []);
  }

  const igdbHits = [
    ...(providerHits.get('igdb') || []),
    ...(providerHits.get('igdb-name') || []),
    ...(providerHits.get('igdb-words') || [])
  ].filter((item, index, all) =>
    item?.providerId
    && item?.title
    && all.findIndex(other => String(other.providerId) === String(item.providerId)) === index
  );

  const igdbDiscovered = igdbHits
    .filter(item => titleMatchesQuery(q, item.title))
    .filter(item => !catalogIgdbIds.has(String(item.providerId)))
    .map(catalogGameFromIgdb);

  igdbDiscovered.forEach(saveDiscoveredGame);

  const igdbTitles = new Set(igdbDiscovered.map(game => normalizeTitle(game.name)));
  const storeGroups = new Map();
  for (const providerName of ['steam', 'microsoft', 'playstation', 'nintendo', 'geforceNow']) {
    for (const item of providerHits.get(providerName) || []) {
      if (!item?.title || !titleMatchesQuery(q, item.title)) continue;
      const titleKey = normalizeTitle(item.title);
      if (!titleKey || catalogTitles.has(titleKey) || igdbTitles.has(titleKey)) continue;
      if (!storeGroups.has(titleKey)) storeGroups.set(titleKey, []);
      storeGroups.get(titleKey).push(item);
    }
  }

  const storeDiscovered = [...storeGroups.values()]
    .map(catalogGameFromProviders)
    .filter(Boolean);

  const games = [...igdbDiscovered, ...storeDiscovered, ...saved]
    .filter((game, index, all) => all.findIndex(item => discoveryIdentity(item) === discoveryIdentity(game)) === index)
    .sort((a, b) => discoveryScore(q, b) - discoveryScore(q, a))
    .slice(0, limit);

  const sources = [];
  if (igdbHits.length) sources.push('IGDB');
  for (const providerName of ['steam', 'microsoft', 'playstation', 'nintendo', 'geforceNow']) {
    if ((providerHits.get(providerName) || []).length) sources.push(providerLabel(providerName));
  }
  if (saved.length) sources.push('saved-IGDB');

  const failures = settled
    .map((result, index) => result.status === 'rejected' ? {
      provider: searches[index][0],
      error: String(result.reason?.message || result.reason || 'Search failed').slice(0, 300)
    } : null)
    .filter(Boolean);

  if (!games.length && failures.length === settled.length && settled.length) {
    throw new Error(`All discovery providers failed: ${failures.map(item => `${item.provider}: ${item.error}`).join('; ')}`);
  }

  res.setHeader('Cache-Control', 'private, max-age=180');
  res.json({
    query: q,
    source: sources.join(', ') || 'none',
    count: games.length,
    games,
    providers: Object.fromEntries(
      [...providerHits.entries()].map(([name, items]) => [name, items.length])
    ),
    failures
  });
}));

app.get('/api/igdb/catalog-range', asyncRoute(async (req, res) => {
  if (!providers.igdb?.catalogRange) return res.status(503).json({ error: 'IGDB is not configured' });
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to must use YYYY-MM-DD' });
  }
  const limit = limitOf(req.query.limit, 500, 500);
  const offset = Math.max(0, Math.min(10000, Number(req.query.offset) || 0));
  const force = bool(req.query.refresh);
  const items = await providers.igdb.catalogRange(from, to, { force, limit, offset });
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({ from, to, offset, limit, count: items.length, items });
}));

app.post('/api/igdb/catalog-batch', asyncRoute(async (req, res) => {
  if (!providers.igdb?.catalogBatch) return res.status(503).json({ error: 'IGDB is not configured' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const numericIds = [...new Set(ids
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0))]
    .slice(0, 500);
  if (!numericIds.length) return res.status(400).json({ error: 'Missing ids' });
  const force = bool(req.query.refresh || req.body?.refresh);
  const items = await providers.igdb.catalogBatch(numericIds, { force });
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({ count: items.length, items });
}));

app.get('/api/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const selected = providerList(req.query.providers);
  const force = bool(req.query.refresh);
  const limit = limitOf(req.query.limit, 8, 20);
  const searchable = selected.filter(provider => provider.search);
  const results = await Promise.allSettled(searchable.map(async provider => ({
    provider: provider.name,
    items: await provider.search(q, { force, limit })
  })));
  res.json({
    query: q,
    results: results.map((result, index) => result.status === 'fulfilled'
      ? result.value
      : { provider: searchable[index]?.name || 'unknown', items: [], error: result.reason?.message || String(result.reason) })
  });
}));

app.post('/api/enrich', asyncRoute(async (req, res) => {
  const games = Array.isArray(req.body?.games) ? req.body.games : [req.body?.game || req.body].filter(Boolean);
  if (!games.length) return res.status(400).json({ error: 'Missing games' });
  if (games.length > 50) return res.status(413).json({ error: 'Maximum 50 games per request' });
  const force = bool(req.query.refresh || req.body?.refresh);
  const providerNames = req.body?.providers || req.query.providers;
  const results = [];
  for (let i = 0; i < games.length; i += 5) {
    const batch = games.slice(i, i + 5);
    results.push(...await Promise.all(batch.map(game => enrichOne(game, { force, providerNames }))));
  }
  res.json({ version: config.version, count: results.length, results });
}));

app.get('/api/gamepass/:kind', asyncRoute(async (req, res) => {
  const kind = String(req.params.kind || 'console');
  const mode = req.query.mode === 'ids' ? 'ids' : 'catalog';
  const force = bool(req.query.refresh);
  if (mode === 'ids') return res.json(await providers.microsoft.gamePassIds(kind, { force }));
  const limit = limitOf(req.query.limit, 1000, 5000);
  const items = await providers.microsoft.gamePassCatalog(kind, { force, limit });
  res.json({ kind, count: items.length, items });
}));

app.get('/api/steam/:appId', asyncRoute(async (req, res) => {
  res.json(await providers.steam.product(req.params.appId, { force: bool(req.query.refresh) }));
}));

app.get('/api/steam-app-list', asyncRoute(async (req, res) => {
  res.json(await providers.steam.appList({ ifModifiedSince: Number(req.query.since || 0), force: bool(req.query.refresh) }));
}));

app.get('/api/xbox/:productId', asyncRoute(async (req, res) => {
  res.json(await providers.microsoft.product(req.params.productId, { force: bool(req.query.refresh) }));
}));

app.get('/api/playstation/product/:productId', asyncRoute(async (req, res) => {
  res.json(await providers.playstation.product(req.params.productId, { force: bool(req.query.refresh) }));
}));

app.get('/api/playstation/concept/:conceptId', asyncRoute(async (req, res) => {
  res.json(await providers.playstation.concept(req.params.conceptId, { force: bool(req.query.refresh) }));
}));

app.get('/api/playstation/plus/:tier', asyncRoute(async (req, res) => {
  res.json(await providers.playstation.psPlus(req.params.tier, { force: bool(req.query.refresh) }));
}));

app.get('/api/playstation/catalog/:category', asyncRoute(async (req, res) => {
  res.json(await providers.playstation.catalog(req.params.category, {
    force: bool(req.query.refresh),
    size: limitOf(req.query.size, 100, 1000),
    offset: Math.max(0, Number(req.query.offset) || 0)
  }));
}));

app.get('/api/nintendo', asyncRoute(async (req, res) => {
  const url = String(req.query.url || '');
  const titleId = String(req.query.id || '');
  if (titleId) return res.json(await providers.nintendo.productById(titleId, { force: bool(req.query.refresh) }));
  if (!url) return res.status(400).json({ error: 'Missing url or id' });
  res.json(await providers.nintendo.productByUrl(url, { force: bool(req.query.refresh) }));
}));

app.get('/api/nintendo/list/:kind', asyncRoute(async (req, res) => {
  res.json(await providers.nintendo.eshopList(req.params.kind, {
    force: bool(req.query.refresh),
    count: limitOf(req.query.count, 30, 100),
    offset: Math.max(0, Number(req.query.offset) || 0)
  }));
}));

app.get('/api/nintendo/price/:titleId', asyncRoute(async (req, res) => {
  res.json(await providers.nintendo.price(req.params.titleId, { force: bool(req.query.refresh) }));
}));

app.get('/api/gfn/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  res.json({ query: q, items: await providers.geforceNow.search(q, { force: bool(req.query.refresh), limit: limitOf(req.query.limit, 8, 30) }) });
}));

app.get('/api/gfn/catalog', asyncRoute(async (req, res) => {
  const items = await providers.geforceNow.list({ force: bool(req.query.refresh), maxPages: limitOf(req.query.pages, 12, 30) });
  res.json({ count: items.length, items });
}));

app.get('/api/history/:gameKey', (req, res) => {
  res.json({ gameKey: req.params.gameKey, items: historyForGame(req.params.gameKey, limitOf(req.query.limit, 100, 500)) });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(502).json({ error: error?.message || String(error) });
});

function utcDay(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function releaseSummary(value) {
  const items = Array.isArray(value) ? value : value?.releases;
  if (!Array.isArray(items) || !items.length) return 'bez známého data';
  const first = items[0];
  if (first?.day) return new Date(`${first.day}T12:00:00Z`).toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  return first?.window || 'bez známého data';
}

function priceChangeSummary(value) {
  const items = Object.values(value || {}).filter(price => price && (price.currentText || price.current != null));
  if (!items.length) return 'cena už není dostupná';
  const price = items[0];
  if (price.isFree === true) return 'nyní zdarma';
  const text = String(price.currentText || '').trim();
  if (text) return `nová cena ${text}`;
  const current = Number(price.current);
  const currency = String(price.currency || '').trim();
  return Number.isFinite(current) ? `nová cena ${current}${currency ? ` ${currency}` : ''}` : 'cena se změnila';
}

function subscriptionChangeSummary(value) {
  const s = value || {};
  const services = [];
  if (s.gamePassConsole) services.push('Game Pass Console');
  if (s.gamePassPc) services.push('PC Game Pass');
  if (s.gamePass && !s.gamePassConsole && !s.gamePassPc) services.push('Game Pass');
  if (s.cloudGaming) services.push('Xbox Cloud Gaming');
  if (s.eaPlay) services.push('EA Play');
  if (s.psPlus) services.push('PS Plus');
  if (s.geforceNow) services.push('GeForce NOW');
  return services.length ? `dostupnost: ${services.join(', ')}` : 'už není v evidovaném předplatném';
}

function pushEventForChange(change) {
  const name = change.game?.name || change.gameKey;
  if (change.field === 'gameAdded') return { key:`change:${change.id}`, title:'Nová sledovaná hra', body:`${name} byla přidána do katalogu.`, game:change.game };
  if (change.field === 'gameRemoved') return { key:`change:${change.id}`, title:'Změna sledované hry', body:`${name} už není v aktuálním katalogu.`, game:change.game };
  if (change.field === 'prices') return { key:`change:${change.id}`, title:'Změna ceny', body:`${name}: ${priceChangeSummary(change.newValue)}.`, game:change.game };
  if (change.field === 'subscriptions') return { key:`change:${change.id}`, title:'Změna předplatného', body:`${name}: ${subscriptionChangeSummary(change.newValue)}.`, game:change.game };
  if (change.field === 'earlyAccess') return {
    key:`change:${change.id}`,
    title:'Změna Early Access',
    body:change.newValue === true ? `${name} vstoupila do Early Access.` : `${name} už není vedena jako Early Access.`,
    game:change.game
  };
  return { key:`change:${change.id}`, title:'Změna data vydání', body:`${name}: nový termín ${releaseSummary(change.newValue)}.`, game:change.game };
}

let pushRunActive = false;
async function runPushNotifications() {
  if (!pushEnabled || pushRunActive) return;
  pushRunActive = true;
  try {
    const catalog = await readCatalog();
    const catalogGames = Array.isArray(catalog.payload) ? catalog.payload : catalog.payload.games;
    const gameMap = new Map(catalogGames.map(game => [String(game.id), game]));
    const today = utcDay();
    const noticeDays = new Map([[utcDay(7), 7], [utcDay(1), 1], [today, 0]]);

    for (const row of listPushSubscriptions()) {
      const ids = [...new Set(row.gameIds.map(String))];
      if (!ids.length) continue;
      const pending = listRecentChanges({ since: row.createdAt, gameKeys: ids, limit: 100 }).map(pushEventForChange)
        .filter(event => !wasPushDelivered(row.endpoint, event.key));

      for (const id of ids) {
        const game = gameMap.get(id) || getDiscoveredGame(id);
        if (!game) continue;
        for (const release of game.releases || []) {
          const day = String(release.date || release.day || '').slice(0, 10);
          if (!noticeDays.has(day)) continue;
          const distance = noticeDays.get(day);
          const key = `release:${id}:${day}:${distance}`;
          if (wasPushDelivered(row.endpoint, key)) continue;
          pending.push({
            key,
            title: distance === 0 ? 'Hra právě vychází' : 'Blíží se vydání hry',
            body: distance === 0 ? `${game.name} vychází dnes.` : `${game.name} vychází ${distance === 1 ? 'zítra' : 'za 7 dní'}.`,
            game: { id, name: game.name }
          });
        }
      }
      if (!pending.length) continue;

      const first = pending[0];
      const extra = pending.length > 1 ? `\nA ${pending.length - 1} další upozornění.` : '';
      const query = new URLSearchParams({ game: String(first.game?.id || '') });
      if (String(first.game?.id || '').startsWith('igdb-')) query.set('q', first.game?.name || '');
      const payload = JSON.stringify({
        title: first.title,
        body: `${first.body}${extra}`,
        url: `/games/?${query}`,
        tag: first.key
      });
      try {
        await webpush.sendNotification(row.subscription, payload, { TTL: 86_400, urgency: 'normal' });
        markPushDelivered(row.endpoint, pending.map(event => event.key));
      } catch (error) {
        if ([404, 410].includes(Number(error?.statusCode))) removePushSubscription(row.endpoint);
        else console.error('Push delivery failed:', error?.message || error);
      }
    }
    prunePushDeliveries();
  } finally {
    pushRunActive = false;
  }
}

app.listen(config.port, config.host, () => {
  console.log(`GameS API ${config.version} listening on http://${config.host}:${config.port}`);
  console.log(`Market=${config.market}, language=${config.language}, PS locale=${config.psLocale}`);
  console.log(`Background push=${pushEnabled ? 'enabled' : 'disabled'}`);
});

if (pushEnabled) {
  setTimeout(() => runPushNotifications().catch(error => console.error('Push scheduler:', error)), 10_000).unref();
  setInterval(() => runPushNotifications().catch(error => console.error('Push scheduler:', error)), config.pushIntervalMs).unref();
}
