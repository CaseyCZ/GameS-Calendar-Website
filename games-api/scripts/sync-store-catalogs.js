#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { db, readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { normalizeTitle, uniq } from '../src/lib/normalize.js';

const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const hit = [...args].find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const force = args.has('--force');
const full = args.has('--full');
const limit = full ? Number.POSITIVE_INFINITY : Math.max(1, Number(argValue('--limit') || 500));
const concurrency = Math.max(1, Math.min(3, Number(argValue('--concurrency') || 2)));
const requested = (argValue('--providers') || 'playstation,nintendo')
  .split(',').map(value => value.trim()).filter(Boolean);
const selected = requested.filter(name => ['playstation', 'nintendo'].includes(name));
const runtimeFile = path.resolve(process.env.GAMES_RUNTIME_CATALOG_FILE || './data/catalog-runtime.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const payload = readCatalog();
if (!payload?.games?.length) {
  console.error('SQLite catalog is empty. Run sync:catalog first.');
  process.exit(2);
}
if (!selected.length) {
  console.error('No valid providers selected.');
  process.exit(2);
}

const games = payload.games;
const updateGameStmt = db.prepare('UPDATE catalog_games SET name = ?, payload = ?, updated_at = ? WHERE game_key = ?');

function persistGame(game) {
  updateGameStmt.run(String(game?.name || ''), JSON.stringify(game || {}), Date.now(), String(game?.id));
}

function normalizeStoreRating(value) {
  const n = Number(value || 0);
  if (!n) return 0;
  if (n <= 5) return Math.round(n * 20 * 10) / 10;
  if (n <= 10) return Math.round(n * 10 * 10) / 10;
  return Math.round(n * 10) / 10;
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

function applyCanonical(game, item, provider) {
  if (!game || !item) return false;
  if (!game.summary && (item.shortDescription || item.description)) game.summary = item.shortDescription || item.description;
  game.developers = uniq([...(game.developers || []), ...(item.developers || [])]);
  game.publishers = uniq([...(game.publishers || []), ...(item.publishers || [])]);
  game.genres = uniq([...(game.genres || []), ...(item.genres || [])]);
  game.storeCategories = uniq([...(game.storeCategories || []), ...(item.categories || [])]);
  game.metadataSources = uniq([...(game.metadataSources || []), provider]);
  game.providerIds ||= {};
  if (item.providerId) game.providerIds[provider] = String(item.providerId);
  if (!game.cover && item.media?.cover) game.cover = item.media.cover;
  game.screenshots = uniqueScreenshots([...(game.screenshots || []), ...(item.media?.screenshots || [])]);
  const rating = normalizeStoreRating(item.rating);
  if (!Number(game.rating || 0) && rating) {
    game.rating = rating;
    game.ratingCount = Number(item.ratingCount || 0) || Number(game.ratingCount || 0) || 0;
    game.ratingSource = provider;
  }
  if (item.earlyAccess) game.earlyAccess = true;
  if (!game.scale) {
    const text = [...(item.genres || []), ...(item.categories || [])].join(' ').toLowerCase();
    if (/\bindie\b/.test(text)) game.scale = 'Indie';
  }
  game.subscriptions = { ...(game.subscriptions || {}), ...(item.subscriptions || {}) };
  game.externalIds ||= {};
  if (provider === 'playstation' && item.providerId) game.externalIds.playstationProduct = String(item.providerId);
  if (provider === 'nintendo' && /^7\d{13}$/.test(String(item.providerId || ''))) game.externalIds.nintendo = String(item.providerId);
  game.links ||= {};
  if (provider === 'playstation' && item.storeUrl) game.links.playstation = item.storeUrl;
  if (provider === 'nintendo' && item.storeUrl) game.links.nintendo = item.storeUrl;
  return true;
}

function hasPlatform(game, rx) {
  return (game.releases || []).some(release => (release.platforms || []).some(platform => rx.test(String(platform?.name || platform?.abbreviation || ''))));
}

function relevant(game, provider) {
  if (provider === 'playstation') return hasPlatform(game, /PlayStation|PS4|PS5/i);
  if (provider === 'nintendo') return hasPlatform(game, /Nintendo Switch/i);
  return false;
}

function missingScore(game) {
  let score = 0;
  if (!(game.developers || []).length) score += 5;
  if (!(game.publishers || []).length) score += 5;
  if (!game.summary) score += 4;
  if (!Number(game.rating || 0)) score += 3;
  if (!(game.screenshots || []).length) score += 2;
  if (!(game.genres || []).length) score += 2;
  if (!game.cover) score += 2;
  return score;
}

function storeKeys(value = '') {
  const base = normalizeTitle(value);
  if (!base) return [];
  const values = [base];
  const simplified = base
    .replace(/\b(cross gen|crossgen|digital|bundle|collection|pack)\b/g, ' ')
    .replace(/\b(deluxe|ultimate|complete|premium|definitive|standard)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (simplified && simplified !== base) values.push(simplified);
  return uniq(values);
}

function namesFor(game) {
  return uniq([game.name, ...(game.aliases || [])].flatMap(storeKeys));
}

function buildIndex(items) {
  const index = new Map();
  for (const item of items || []) {
    for (const key of storeKeys(item?.title || '')) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(item);
    }
  }
  return index;
}

function releaseTimes(game) {
  return (game.releases || [])
    .map(release => Date.parse(`${release?.date || ''}T00:00:00Z`))
    .filter(Number.isFinite);
}

function candidateDistance(game, item) {
  const t = Date.parse(item?.releaseDate || '');
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  const times = releaseTimes(game);
  if (!times.length) return Number.POSITIVE_INFINITY;
  return Math.min(...times.map(value => Math.abs(value - t)));
}

function bestExact(game, index) {
  const found = [];
  const seen = new Set();
  for (const key of namesFor(game)) {
    for (const item of index.get(key) || []) {
      const id = `${item.provider}:${item.providerId || item.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(item);
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => candidateDistance(game, a) - candidateDistance(game, b));
  return found[0];
}

function markCheck(game, provider, matched, detail = '') {
  game.providerChecks ||= {};
  game.providerChecks[`${provider}-catalog-match`] = {
    checkedAt: new Date().toISOString(),
    matched: Boolean(matched),
    detail: String(detail || '').slice(0, 220)
  };
}

async function mapLimit(items, worker) {
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
}

async function loadPlayStationCatalog() {
  const items = await providers.playstation.catalogProducts('all', {
    force,
    size: 1000,
    maxPages: Number(process.env.GAMES_PS_CATALOG_MAX_PAGES || 50)
  });
  console.log(`PlayStation official catalog: ${items.length} products`);
  return items;
}

async function loadNintendoCatalog() {
  const out = [];
  const seen = new Set();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const pageSize = 100;
  const maxPages = Math.max(1, Number(process.env.GAMES_NINTENDO_CATALOG_MAX_PAGES || 300));
  for (let page = 0; page < maxPages && offset < total; page += 1) {
    const result = await providers.nintendo.eshopList('new', { force, count: pageSize, offset });
    total = Number(result?.total || 0) || total;
    const items = result?.contents || [];
    for (const item of items) {
      const key = String(item?.providerId || `${item?.title}:${item?.releaseDate}`);
      if (!item?.title || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    if (!items.length || items.length < pageSize) break;
    offset += pageSize;
    if ((page + 1) % 25 === 0) console.log(`Nintendo catalog pages=${page + 1}, products=${out.length}, total=${Number.isFinite(total) ? total : '?'}`);
  }
  console.log(`Nintendo official catalog: ${out.length} products`);
  return out;
}

async function richerPlayStation(item) {
  const id = String(item?.providerId || '');
  if (!id) return item;
  try {
    const detail = await providers.playstation.product(id, { force });
    return detail?.title ? detail : item;
  } catch {
    return item;
  }
}

const catalogs = {};
if (selected.includes('playstation')) catalogs.playstation = await loadPlayStationCatalog();
if (selected.includes('nintendo')) catalogs.nintendo = await loadNintendoCatalog();

const statsByProvider = {};
for (const provider of selected) {
  const items = catalogs[provider] || [];
  const index = buildIndex(items);
  let queue = games
    .filter(game => relevant(game, provider) && missingScore(game) > 0 && bestExact(game, index))
    .sort((a, b) => missingScore(b) - missingScore(a) || String(a.name).localeCompare(String(b.name), 'cs'));
  const eligible = queue.length;
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);

  const stats = { catalog: items.length, eligible, processed: 0, matched: 0, idsAdded: 0 };
  statsByProvider[provider] = stats;
  console.log(`\n=== ${provider.toUpperCase()} BULK CATALOG MATCH ===`);
  console.log(`catalog=${items.length} exactEligible=${eligible} processing=${queue.length}`);

  await mapLimit(queue, async (game, indexNumber) => {
    const item = bestExact(game, index);
    if (!item) return;
    const beforeId = provider === 'playstation' ? game.externalIds?.playstationProduct : game.externalIds?.nintendo;
    const detail = provider === 'playstation' ? await richerPlayStation(item) : item;
    applyCanonical(game, detail, provider);
    const afterId = provider === 'playstation' ? game.externalIds?.playstationProduct : game.externalIds?.nintendo;
    if (!beforeId && afterId) stats.idsAdded++;
    markCheck(game, provider, true, `${detail.title || item.title} [${detail.providerId || item.providerId || ''}]`);
    persistGame(game);
    stats.processed++;
    stats.matched++;
    if ((indexNumber + 1) % 50 === 0 || indexNumber + 1 === queue.length) {
      console.log(`${provider}: ${indexNumber + 1}/${queue.length} matched=${stats.matched} idsAdded=${stats.idsAdded}`);
    }
    await sleep(provider === 'playstation' ? 90 : 30);
  });
}

const now = new Date().toISOString();
const refreshed = readCatalog();
const next = {
  ...refreshed,
  generatedAt: now,
  provider: 'igdb+official-stores',
  sync: {
    ...(refreshed.sync || {}),
    storeCatalogCheckedAt: now,
    storeCatalogProviders: selected,
    storeCatalogFull: full,
    storeCatalogLimit: Number.isFinite(limit) ? limit : null
  }
};
replaceCatalog(next, { source: 'sync:store-catalogs', sourceMtime: Date.now() });
const stored = readCatalog() || next;
fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
const temp = `${runtimeFile}.tmp`;
fs.writeFileSync(temp, JSON.stringify(stored));
fs.renameSync(temp, runtimeFile);

const count = fn => stored.games.reduce((sum, game) => sum + (fn(game) ? 1 : 0), 0);
console.log('\n=== COVERAGE AFTER BULK STORE MATCH ===');
console.log(`games = ${stored.games.length}`);
console.log(`developers = ${count(game => game.developers?.length)}`);
console.log(`publishers = ${count(game => game.publishers?.length)}`);
console.log(`genres = ${count(game => game.genres?.length)}`);
console.log(`description = ${count(game => game.summary || game.storyline)}`);
console.log(`screenshots = ${count(game => game.screenshots?.length)}`);
console.log(`rating = ${count(game => Number(game.rating || 0) > 0)}`);
console.log(`playstationId = ${count(game => game.externalIds?.playstationProduct || game.externalIds?.playstationConcept || game.externalIds?.playstation)}`);
console.log(`nintendoId = ${count(game => game.externalIds?.nintendo)}`);
console.log('\n=== PROVIDERS ===');
for (const [provider, stats] of Object.entries(statsByProvider)) {
  console.log(`${provider}: catalog=${stats.catalog} exactEligible=${stats.eligible} processed=${stats.processed} matched=${stats.matched} idsAdded=${stats.idsAdded}`);
}
console.log('Saved incrementally to SQLite and refreshed runtime catalog.');
