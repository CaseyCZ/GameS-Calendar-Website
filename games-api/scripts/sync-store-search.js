#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { db, readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { normalizeTitle, titleScore, uniq } from '../src/lib/normalize.js';

const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const hit = [...args].find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const force = args.has('--force');
const full = args.has('--full');
const limit = full ? Number.POSITIVE_INFINITY : Math.max(1, Number(argValue('--limit') || process.env.GAMES_SEARCH_METADATA_LIMIT || 200));
const concurrency = Math.max(1, Math.min(3, Number(argValue('--concurrency') || process.env.GAMES_SEARCH_METADATA_CONCURRENCY || 2)));
const requested = (argValue('--providers') || 'playstation,nintendo')
  .split(',').map(value => value.trim()).filter(Boolean);
const allowed = new Set(['steam', 'microsoft', 'playstation', 'nintendo']);
const selected = requested.filter(name => allowed.has(name));
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
  game.externalIds ||= {};
  if (item.externalIds) game.externalIds = { ...game.externalIds, ...item.externalIds };
  if (item.providerId) {
    if (provider === 'steam') game.externalIds.steam ||= String(item.providerId);
    if (provider === 'microsoft') game.externalIds.microsoft ||= String(item.providerId);
    if (provider === 'nintendo' && /^7\d{13}$/.test(String(item.providerId))) game.externalIds.nintendo = String(item.providerId);
    if (provider === 'playstation') {
      const id = String(item.providerId);
      if (/^\d+$/.test(id)) game.externalIds.playstationConcept ||= id;
      else game.externalIds.playstationProduct ||= id;
    }
  }
  game.links ||= {};
  if (provider === 'steam' && item.storeUrl) game.links.steam = item.storeUrl;
  if (provider === 'microsoft' && item.storeUrl) game.links.xbox = item.storeUrl;
  if (provider === 'playstation' && item.storeUrl) game.links.playstation = item.storeUrl;
  if (provider === 'nintendo' && item.storeUrl) game.links.nintendo = item.storeUrl;
  return true;
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

function hasPlatform(game, rx) {
  return (game.releases || []).some(release => (release.platforms || []).some(platform => rx.test(String(platform?.name || platform?.abbreviation || ''))));
}

function relevant(game, provider) {
  if (provider === 'steam') return hasPlatform(game, /PC|Windows|Linux|Mac/i);
  if (provider === 'microsoft') return hasPlatform(game, /Xbox/i);
  if (provider === 'playstation') return hasPlatform(game, /PlayStation|PS4|PS5/i);
  if (provider === 'nintendo') return hasPlatform(game, /Nintendo Switch/i);
  return false;
}

function checkedRecently(game, provider, days = 30) {
  if (force) return false;
  const checked = Date.parse(game.providerChecks?.[`${provider}-search-metadata`]?.checkedAt || '');
  return Number.isFinite(checked) && Date.now() - checked < days * 86_400_000;
}

function markCheck(game, provider, matched, detail = '') {
  game.providerChecks ||= {};
  game.providerChecks[`${provider}-search-metadata`] = {
    checkedAt: new Date().toISOString(),
    matched: Boolean(matched),
    detail: String(detail || '').slice(0, 200)
  };
}

function namesFor(game) {
  return uniq([game.name, ...(game.aliases || [])]).map(normalizeTitle).filter(Boolean);
}

function bestHit(game, hits, provider) {
  let best = null;
  for (const item of hits || []) {
    if (!item?.title) continue;
    let score = 0;
    for (const name of namesFor(game)) score = Math.max(score, titleScore(name, item.title));
    if (!best || score > best.score) best = { item, score };
  }
  const threshold = provider === 'nintendo' ? 0.82 : provider === 'playstation' ? 0.84 : 0.88;
  return best && best.score >= threshold ? best : null;
}

async function searchProvider(game, provider) {
  const api = providers[provider];
  if (!api?.search) throw new Error(`${provider} search is unavailable`);
  const hits = await api.search(game.name, { force, limit: provider === 'playstation' ? 5 : 6 });
  const best = bestHit(game, hits, provider);
  if (!best) {
    const top = (hits || [])[0]?.title || 'no hit';
    throw new Error(`No safe title match; top=${top}`);
  }
  return best;
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
    .filter(game => relevant(game, provider) && missingScore(game) > 0 && !checkedRecently(game, provider))
    .sort((a, b) => missingScore(b) - missingScore(a) || String(a.name).localeCompare(String(b.name), 'cs'));
  const totalEligible = queue.length;
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);

  const stats = { eligible: totalEligible, processed: 0, matched: 0, failed: 0, ratings: 0 };
  providerStats[provider] = stats;
  console.log(`\n=== ${provider.toUpperCase()} SEARCH FALLBACK ===`);
  console.log(`eligible=${totalEligible} processing=${queue.length} concurrency=${concurrency}`);

  await mapLimit(queue, async (game, index) => {
    try {
      const beforeRating = Number(game.rating || 0);
      const { item, score } = await searchProvider(game, provider);
      applyCanonical(game, item, provider);
      if (!beforeRating && Number(game.rating || 0)) stats.ratings++;
      markCheck(game, provider, true, `${item.title}; score=${score.toFixed(3)}`);
      stats.matched++;
    } catch (error) {
      markCheck(game, provider, false, error?.message || String(error));
      stats.failed++;
    }
    stats.processed++;
    persistGame(game);
    if ((index + 1) % 25 === 0 || index + 1 === queue.length) {
      console.log(`${provider}: ${index + 1}/${queue.length} matched=${stats.matched} failed=${stats.failed} newRatings=${stats.ratings}`);
    }
    await sleep(provider === 'playstation' ? 180 : provider === 'nintendo' ? 120 : 140);
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
    storeSearchCheckedAt: now,
    storeSearchProviders: selected,
    storeSearchFull: full,
    storeSearchLimit: Number.isFinite(limit) ? limit : null
  }
};
replaceCatalog(next, { source: 'sync:store-search', sourceMtime: Date.now() });
const stored = readCatalog() || next;
fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
const temp = `${runtimeFile}.tmp`;
fs.writeFileSync(temp, JSON.stringify(stored));
fs.renameSync(temp, runtimeFile);

const count = fn => stored.games.reduce((sum, game) => sum + (fn(game) ? 1 : 0), 0);
console.log('\n=== COVERAGE AFTER STORE SEARCH ===');
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
