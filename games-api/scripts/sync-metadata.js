#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { db, readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { uniq } from '../src/lib/normalize.js';

const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const hit = [...args].find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const force = args.has('--force');
const full = args.has('--full');
const reviews = !args.has('--no-reviews');
const limit = full ? Number.POSITIVE_INFINITY : Math.max(1, Number(argValue('--limit') || process.env.GAMES_METADATA_LIMIT || 300));
const concurrency = Math.max(1, Math.min(4, Number(argValue('--concurrency') || process.env.GAMES_METADATA_CONCURRENCY || 3)));
const requested = (argValue('--providers') || 'steam,microsoft,playstation,nintendo')
  .split(',').map(value => value.trim()).filter(Boolean);
const allowed = new Set(['steam', 'microsoft', 'playstation', 'nintendo']);
const selected = requested.filter(name => allowed.has(name));
const runtimeFile = path.resolve(process.env.GAMES_RUNTIME_CATALOG_FILE || './data/catalog-runtime.json');

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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function trailerFromUrl(url = '') {
  const youtube = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return youtube?.[1] || '';
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
  if (!game.trailerUrl && item.media?.trailers?.[0]) game.trailerUrl = item.media.trailers[0];
  if (!game.trailerId && game.trailerUrl) game.trailerId = trailerFromUrl(game.trailerUrl);
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
  if (item.externalIds) game.externalIds = { ...(game.externalIds || {}), ...item.externalIds };
  game.links ||= {};
  if (provider === 'steam' && item.storeUrl) game.links.steam = item.storeUrl;
  if (provider === 'microsoft' && item.storeUrl) game.links.xbox = item.storeUrl;
  if (provider === 'playstation' && item.storeUrl) game.links.playstation = item.storeUrl;
  if (provider === 'nintendo' && item.storeUrl) game.links.nintendo = item.storeUrl;
  return true;
}

function markCheck(game, provider, matched, detail = '') {
  game.providerChecks ||= {};
  game.providerChecks[`${provider}-metadata`] = {
    checkedAt: new Date().toISOString(),
    matched: Boolean(matched),
    detail: String(detail || '').slice(0, 180)
  };
}

function checkedRecently(game, provider, days = 30) {
  if (force) return false;
  const checked = Date.parse(game.providerChecks?.[`${provider}-metadata`]?.checkedAt || '');
  return Number.isFinite(checked) && Date.now() - checked < days * 86_400_000;
}

function directId(game, provider) {
  const ids = game.externalIds || {};
  if (provider === 'steam') return ids.steam ? String(ids.steam) : '';
  if (provider === 'microsoft') return String(ids.microsoft || ids.xbox || '');
  if (provider === 'nintendo') return ids.nintendo ? String(ids.nintendo) : '';
  if (provider === 'playstation') return String(ids.playstationProduct || ids.playstationConcept || ids.playstation || '');
  return '';
}

function missingScore(game) {
  let score = 0;
  if (!(game.developers || []).length) score += 5;
  if (!(game.publishers || []).length) score += 5;
  if (!game.summary) score += 4;
  if (!game.trailerId && !game.trailerUrl) score += 3;
  if (!Number(game.rating || 0)) score += 3;
  if (!(game.screenshots || []).length) score += 2;
  if (!(game.genres || []).length) score += 2;
  if (!game.cover) score += 2;
  return score;
}

async function steamReview(appId) {
  const url = new URL(`https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}`);
  url.searchParams.set('json', '1');
  url.searchParams.set('language', 'all');
  url.searchParams.set('purchase_type', 'all');
  url.searchParams.set('num_per_page', '0');
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent } });
  if (!response.ok) throw new Error(`Steam reviews HTTP ${response.status}`);
  const data = await response.json();
  const summary = data?.query_summary || {};
  const total = Number(summary.total_reviews || 0);
  const positive = Number(summary.total_positive || 0);
  return { rating: total > 0 ? Math.round((positive / total) * 1000) / 10 : 0, ratingCount: total };
}

async function fetchDirect(game, provider) {
  const ids = game.externalIds || {};
  if (provider === 'steam') {
    return providers.steam.product(String(ids.steam), { force });
  }
  if (provider === 'microsoft') {
    return providers.microsoft.product(String(ids.microsoft || ids.xbox), { force, includeSubscriptions: false });
  }
  if (provider === 'nintendo') {
    return providers.nintendo.productById(String(ids.nintendo), { force });
  }
  if (provider === 'playstation') {
    const generic = String(ids.playstation || '');
    if (ids.playstationProduct) return providers.playstation.product(String(ids.playstationProduct), { force });
    if (ids.playstationConcept) return providers.playstation.concept(String(ids.playstationConcept), { force });
    if (/^(?:UP|EP|JP|HP|PP|CUSA|PPSA)/i.test(generic)) return providers.playstation.product(generic, { force });
    if (/^\d+$/.test(generic)) return providers.playstation.concept(generic, { force });
    throw new Error(`Unsupported PlayStation ID: ${generic}`);
  }
  return null;
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

const providerStats = {};

for (const provider of selected) {
  let queue = games
    .filter(game => directId(game, provider) && !checkedRecently(game, provider))
    .sort((a, b) => missingScore(b) - missingScore(a) || String(a.name).localeCompare(String(b.name), 'cs'));
  const totalEligible = queue.length;
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);

  const stats = { eligible: totalEligible, processed: 0, matched: 0, failed: 0, ratings: 0 };
  providerStats[provider] = stats;
  console.log(`\n=== ${provider.toUpperCase()} ===`);
  console.log(`eligible=${totalEligible} processing=${queue.length} concurrency=${concurrency}`);

  await mapLimit(queue, async (game, index) => {
    try {
      const beforeRating = Number(game.rating || 0);
      const item = await fetchDirect(game, provider);
      if (!item?.title) throw new Error('Provider returned no title');
      applyCanonical(game, item, provider);

      if (provider === 'steam' && reviews && !Number(game.rating || 0)) {
        try {
          const review = await steamReview(String(game.externalIds.steam));
          if (review.rating) {
            game.rating = review.rating;
            game.ratingCount = review.ratingCount;
            game.ratingSource = 'steam-reviews';
          }
        } catch {}
      }

      if (!beforeRating && Number(game.rating || 0)) stats.ratings++;
      markCheck(game, provider, true, item.title);
      stats.matched++;
    } catch (error) {
      markCheck(game, provider, false, error?.message || String(error));
      stats.failed++;
    }
    stats.processed++;
    persistGame(game);
    if ((index + 1) % 50 === 0 || index + 1 === queue.length) {
      console.log(`${provider}: ${index + 1}/${queue.length} matched=${stats.matched} failed=${stats.failed} newRatings=${stats.ratings}`);
    }
    await sleep(provider === 'steam' ? 110 : 80);
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
    metadataCheckedAt: now,
    metadataProviders: selected,
    metadataFull: full,
    metadataLimit: Number.isFinite(limit) ? limit : null
  }
};
replaceCatalog(next, { source: 'sync:metadata', sourceMtime: Date.now() });
const stored = readCatalog() || next;
fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
const temp = `${runtimeFile}.tmp`;
fs.writeFileSync(temp, JSON.stringify(stored));
fs.renameSync(temp, runtimeFile);

const count = fn => stored.games.reduce((sum, game) => sum + (fn(game) ? 1 : 0), 0);
console.log('\n=== COVERAGE AFTER METADATA SYNC ===');
console.log(`games = ${stored.games.length}`);
console.log(`developers = ${count(game => game.developers?.length)}`);
console.log(`publishers = ${count(game => game.publishers?.length)}`);
console.log(`genres = ${count(game => game.genres?.length)}`);
console.log(`description = ${count(game => game.summary || game.storyline)}`);
console.log(`screenshots = ${count(game => game.screenshots?.length)}`);
console.log(`trailer = ${count(game => game.trailerId || game.trailerUrl)}`);
console.log(`rating = ${count(game => Number(game.rating || 0) > 0)}`);
console.log('\n=== PROVIDERS ===');
for (const [provider, stats] of Object.entries(providerStats)) {
  console.log(`${provider}: eligible=${stats.eligible} processed=${stats.processed} matched=${stats.matched} failed=${stats.failed} newRatings=${stats.ratings}`);
}
console.log('Saved incrementally to SQLite and refreshed runtime catalog.');
