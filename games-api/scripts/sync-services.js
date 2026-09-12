#!/usr/bin/env node
import { readCatalog, replaceCatalog } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { normalizeTitle, titleScore, uniq } from '../src/lib/normalize.js';

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

function psIdentityCandidates(game) {
  return uniq([
    game.externalIds?.playstationProduct,
    game.externalIds?.playstation,
    game.providerIds?.playstation
  ].map(value => String(value || '').trim()).filter(Boolean));
}

function fuzzyPsMatch(game, items) {
  let best = null;
  for (const name of namesFor(game)) {
    for (const item of items) {
      const score = titleScore(name, item?.title || '');
      if (!best || score > best.score) best = { item, score };
    }
  }
  return best?.score >= 0.72 ? best.item : null;
}

async function syncPsPlus() {
  const items = await providers.playstation.psPlusCatalog({ force, size: 200, maxPages: 5 });
  if (!items.length) throw new Error('PlayStation PS Plus monthly catalog returned zero games');

  const byId = new Map(items.map(item => [String(item.providerId || ''), item]));
  const byTitle = exactIndex(items);
  const matchedCatalogIds = new Set();
  let matched = 0;

  for (const game of games) {
    let item = null;
    for (const id of psIdentityCandidates(game)) {
      if (byId.has(id)) { item = byId.get(id); break; }
    }
    item ||= matchExact(game, byTitle);
    item ||= fuzzyPsMatch(game, items);
    if (!item) continue;

    game.subscriptions.psPlus = true;
    addBasicMetadata(game, item, 'playstation');
    matchedCatalogIds.add(String(item.providerId || item.title));
    matched++;
  }

  console.log(`PS Plus catalog games: ${items.length}`);
  console.log(`PS Plus matched games: ${matched}`);
  console.log(`PS Plus matched catalog entries: ${matchedCatalogIds.size}/${items.length}`);
  for (const item of items) console.log(`  PS Plus: ${item.title} [${item.providerId}]`);
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
