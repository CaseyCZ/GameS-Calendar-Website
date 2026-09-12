import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { historyForGame, listHealth, saveGameSnapshot, saveHealth } from './db.js';
import { mergeGames, normalizeTitle, titleScore } from './lib/normalize.js';
import { providers, providerList } from './providers/index.js';

const app = express();
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

async function enrichOne(input, { force = false, providerNames } = {}) {
  const game = typeof input === 'string' ? { title: input } : (input || {});
  const title = String(game.title || game.name || '').trim();
  const found = [];

  const direct = [
    game.steamId && providers.steam.product(String(game.steamId), { force }),
    game.xboxProductId && providers.microsoft.product(String(game.xboxProductId), { force }),
    game.microsoftProductId && providers.microsoft.product(String(game.microsoftProductId), { force }),
    game.psProductId && providers.playstation.product(String(game.psProductId), { force }),
    game.psConceptId && providers.playstation.concept(String(game.psConceptId), { force }),
    game.nintendoUrl && providers.nintendo.productByUrl(String(game.nintendoUrl), { force }),
    game.nintendoTitleId && providers.nintendo.productById(String(game.nintendoTitleId), { force })
  ].filter(Boolean);

  if (direct.length) {
    for (const result of await Promise.allSettled(direct)) {
      if (result.status === 'fulfilled' && result.value) found.push(result.value);
    }
  }

  if (title) {
    const selected = providerList(providerNames).filter(provider => typeof provider.search === 'function');
    const searched = await Promise.allSettled(selected.map(provider => bestSearchHit(provider, title, { force })));
    for (const result of searched) {
      if (result.status !== 'fulfilled' || !result.value?.item) continue;
      const threshold = result.value.item.provider === 'nintendo' ? 0.55 : 0.48;
      if (result.value.score >= threshold && !found.some(item => item.provider === result.value.item.provider)) {
        found.push(result.value.item);
      }
    }
  }

  const merged = mergeGames(found);
  const gameKey = String(game.id || game.slug || normalizeTitle(title || merged?.title || '')).trim();
  const changes = merged && gameKey ? saveGameSnapshot(gameKey, merged, 'live-enrich') : [];
  return {
    query: game,
    gameKey,
    matchedProviders: found.map(item => item.provider),
    merged,
    changes,
    providers: Object.fromEntries(found.map(item => [item.provider, item]))
  };
}

app.get('/', (req, res) => {
  res.json({
    name: 'GameS Calendar API',
    version: '0.1.0',
    market: config.market,
    language: config.language,
    providers: Object.values(providers).map(provider => ({ name: provider.name, capabilities: provider.capabilities }))
  });
});

app.get('/health', asyncRoute(async (req, res) => {
  if (!bool(req.query.refresh)) return res.json({ ok: true, cached: listHealth() });
  const results = await Promise.all(Object.values(providers).map(providerHealth));
  res.status(results.every(item => item.ok) ? 200 : 207).json({ ok: results.every(item => item.ok), results });
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
  res.json({ count: results.length, results });
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

app.listen(config.port, '0.0.0.0', () => {
  console.log(`GameS API listening on http://0.0.0.0:${config.port}`);
  console.log(`Market=${config.market}, language=${config.language}, PS locale=${config.psLocale}`);
});
