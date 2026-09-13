import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { historyForGame, listHealth, saveGameSnapshot, saveHealth } from './db.js';
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

async function readCatalog() {
  const errors = [];
  for (const file of CATALOG_FILES) {
    try {
      const payload = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(payload) && !Array.isArray(payload?.games)) {
        throw new Error('catalog has no games array');
      }
      return stripPricing(payload);
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

app.get('/api/catalog', asyncRoute(async (req, res) => {
  const payload = await readCatalog();
  res.setHeader('Cache-Control', 'no-store');
  if (Array.isArray(payload)) return res.json(payload);
  res.json({ ...payload, apiVersion: config.version, source: 'games-api-catalog' });
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
