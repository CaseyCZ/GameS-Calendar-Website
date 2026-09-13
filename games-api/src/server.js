import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { config } from './config.js';
import {
  getDiscoveredGame,
  historyForGame,
  listHealth,
  saveDiscoveredGame,
  saveGameSnapshot,
  saveHealth,
  searchDiscoveredGames
} from './db.js';
import { mergeGames, normalizeTitle, titleScore } from './lib/normalize.js';
import { providers, providerList } from './providers/index.js';

const app = express();
// Only the local Nginx proxy may supply the client address.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
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

function catalogGameFromIgdb(item) {
  const byDay = new Map();
  for (const release of item?.releaseDates || []) {
    const day = String(release?.day || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, new Set());
    if (release.platform) byDay.get(day).add(String(release.platform));
  }
  if (!byDay.size && item?.releaseDate) {
    byDay.set(String(item.releaseDate).slice(0, 10), new Set(item.platforms || []));
  }
  const releases = [...byDay.entries()].map(([day, platforms]) => ({
    day,
    timestamp: Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000),
    platforms: [...platforms].map(name => ({ name, abbreviation: name })),
    precision: 'day',
    regions: []
  }));
  if (!releases.length) {
    releases.push({
      day: null,
      timestamp: 0,
      platforms: (item?.platforms || []).map(name => ({ name, abbreviation: name })),
      window: 'TBA',
      precision: 'unknown',
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
  const hits = await provider.search(title, { force, limit: 5 });
  return (hits || [])
    .map(item => ({ item, score: titleScore(title, item?.title) }))
    .sort((a, b) => b.score - a.score)[0] || null;
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

app.get('/api/discover', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 3) return res.status(400).json({ error: 'Search must have at least 3 characters' });
  if (!providers.igdb) return res.status(503).json({ error: 'IGDB is not configured' });
  const limit = limitOf(req.query.limit, 5, 8);
  const catalog = await readCatalog();
  const catalogGames = Array.isArray(catalog.payload) ? catalog.payload : catalog.payload.games;
  const catalogIgdbIds = new Set(catalogGames.map(game => String(game.igdbId || '')).filter(Boolean));
  const catalogTitles = new Set(catalogGames.flatMap(game => [game.name, ...(game.aliases || [])]).map(normalizeTitle).filter(Boolean));
  if (catalogTitles.has(normalizeTitle(q))) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.json({ query: q, source: 'catalog', count: 0, games: [] });
  }
  const saved = searchDiscoveredGames(q, limit)
    .filter(game => !catalogIgdbIds.has(String(game.igdbId || '')) && !catalogTitles.has(normalizeTitle(game.name)));
  const isExact = game => [game.name, ...(game.aliases || [])].some(name => normalizeTitle(name) === normalizeTitle(q));
  if (saved.some(isExact)) {
    const games = saved.sort((a, b) => titleScore(q, b.name) - titleScore(q, a.name)).slice(0, limit);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.json({ query: q, source: 'saved-IGDB', count: games.length, games });
  }
  const hits = await providers.igdb.search(q, { limit });
  const discovered = hits
    .filter(item => item?.providerId && item?.title)
    .filter(item => !catalogIgdbIds.has(String(item.providerId)) && !catalogTitles.has(normalizeTitle(item.title)))
    .map(catalogGameFromIgdb);
  discovered.forEach(saveDiscoveredGame);
  const games = [...saved, ...discovered]
    .filter((game, index, all) => all.findIndex(item => String(item.id) === String(game.id)) === index)
    .sort((a, b) => titleScore(q, b.name) - titleScore(q, a.name))
    .slice(0, limit);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({ query: q, source: 'IGDB', count: games.length, games });
}));

app.get('/api/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
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

app.listen(config.port, config.host, () => {
  console.log(`GameS API ${config.version} listening on http://${config.host}:${config.port}`);
  console.log(`Market=${config.market}, language=${config.language}, PS locale=${config.psLocale}`);
});
