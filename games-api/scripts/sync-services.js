#!/usr/bin/env node
import { readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { normalizeTitle, uniq } from '../src/lib/normalize.js';

const force = process.argv.includes('--force');
const payload = readCatalog();
if (!payload?.games?.length) {
  console.error('SQLite catalog is empty. Run sync:catalog first.');
  process.exit(2);
}

const games = payload.games;
const SERVICE_KEYS = ['gamePass','gamePassConsole','gamePassPc','cloudGaming','psPlus','geforceNow'];

for (const game of games) {
  game.subscriptions ||= {};
  for (const key of SERVICE_KEYS) game.subscriptions[key] = false;
}

const namesFor = game => uniq([game.name, ...(game.aliases || [])]).map(normalizeTitle).filter(Boolean);
const exactIndex = items => {
  const index = new Map();
  for (const item of items || []) {
    const key = normalizeTitle(item?.title || '');
    if (key && !index.has(key)) index.set(key, item);
  }
  return index;
};
const matchExact = (game, index) => {
  for (const key of namesFor(game)) if (index.has(key)) return index.get(key);
  return null;
};

function addBasicMetadata(game, item, source) {
  if (!item) return;
  if (!game.summary && (item.shortDescription || item.description)) game.summary = item.shortDescription || item.description;
  game.developers = uniq([...(game.developers || []), ...(item.developers || [])]);
  game.publishers = uniq([...(game.publishers || []), ...(item.publishers || [])]);
  game.genres = uniq([...(game.genres || []), ...(item.genres || [])]);
  game.storeCategories = uniq([...(game.storeCategories || []), ...(item.categories || [])]);
  game.metadataSources = uniq([...(game.metadataSources || []), source]);
  if (!game.cover && item.media?.cover) game.cover = item.media.cover;
  game.providerIds ||= {};
  if (item.providerId) game.providerIds[source] = String(item.providerId);
}

async function syncGamePass() {
  const kinds = [
    ['console','gamePassConsole'],
    ['pc','gamePassPc'],
    ['cloud','cloudGaming']
  ];
  const matchedGames = new Set();
  for (const [kind, flag] of kinds) {
    const items = await providers.microsoft.gamePassCatalog(kind, { force, limit: 5000 });
    const byId = new Map(items.map(item => [String(item.providerId || ''), item]));
    const byTitle = exactIndex(items);
    let matched = 0;
    for (const game of games) {
      const id = String(game.externalIds?.microsoft || game.externalIds?.xbox || game.providerIds?.microsoft || '');
      const item = (id && byId.get(id)) || matchExact(game, byTitle);
      if (!item) continue;
      game.subscriptions[flag] = true;
      game.subscriptions.gamePass = true;
      addBasicMetadata(game, item, 'microsoft');
      matchedGames.add(String(game.id));
      matched++;
    }
    console.log(`Game Pass ${kind}: ${matched}`);
  }
  console.log(`Game Pass unique games: ${matchedGames.size}`);
}

async function syncGfn() {
  const items = await providers.geforceNow.list({ force, maxPages: 30 });
  const byTitle = exactIndex(items);
  let matched = 0;
  for (const game of games) {
    const item = matchExact(game, byTitle);
    if (!item) continue;
    game.subscriptions.geforceNow = true;
    addBasicMetadata(game, item, 'geforceNow');
    matched++;
  }
  console.log(`GeForce NOW: ${matched}`);
}

async function syncPsPlus() {
  const names = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      for (const key of ['name','title','productName','conceptName']) {
        if (typeof value[key] === 'string' && value[key].trim().length > 1) names.add(normalizeTitle(value[key]));
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  };

  for (const tier of ['TIER_10','TIER_20','TIER_30']) {
    try { walk(await providers.playstation.psPlus(tier, { force })); }
    catch (error) { console.warn(`PS Plus ${tier}: ${error.message}`); }
  }

  let matched = 0;
  for (const game of games) {
    if (!namesFor(game).some(name => names.has(name))) continue;
    game.subscriptions.psPlus = true;
    matched++;
  }
  console.log(`PS Plus: ${matched}`);
}

await syncGamePass().catch(error => console.warn(`Game Pass sync failed: ${error.message}`));
await syncGfn().catch(error => console.warn(`GeForce NOW sync failed: ${error.message}`));
await syncPsPlus().catch(error => console.warn(`PS Plus sync failed: ${error.message}`));

const now = new Date().toISOString();
for (const game of games) game.subscriptions.checkedAt = now;

const next = {
  ...payload,
  generatedAt: now,
  provider: 'igdb+official-stores',
  games,
  sync: {
    ...(payload.sync || {}),
    servicesCheckedAt: now
  }
};
replaceCatalog(next, { source: 'sync:services', sourceMtime: Date.now() });

const count = key => games.filter(game => Boolean(game.subscriptions?.[key])).length;
console.log('\n=== SERVICES ===');
for (const key of SERVICE_KEYS) console.log(`${key} = ${count(key)}`);
console.log(`games = ${games.length}`);
console.log('Saved to SQLite.');
