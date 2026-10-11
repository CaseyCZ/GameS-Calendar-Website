#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');

const INPUT = process.env.GAMES_INPUT || 'games.json';
const API_BASE = String(process.env.GAMES_LIVE_API || 'https://130.61.49.108/games-api').replace(/\/+$/,'');
const DRY_RUN = process.argv.includes('--dry-run') || process.env.SUBSCRIPTIONS_DRY_RUN === '1';
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.SUBSCRIPTIONS_TIMEOUT_MS || 45000));
const ROMAN = new Map([
  ['i','1'],['ii','2'],['iii','3'],['iv','4'],['v','5'],['vi','6'],['vii','7'],['viii','8'],['ix','9'],['x','10'],
  ['xi','11'],['xii','12'],['xiii','13'],['xiv','14'],['xv','15'],['xvi','16'],['xvii','17'],['xviii','18'],['xix','19'],['xx','20']
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uniq = values => [...new Set((values || []).filter(Boolean))];

function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => ROMAN.get(token) || token)
    .join(' ');
}

function stripStoreSuffix(value = '') {
  return String(value)
    .replace(/\s*[|–—-]\s*(?:ps4|ps5|ps4\s*&\s*ps5|playstation\s*4|playstation\s*5|xbox\s*one|xbox\s*series\s*x\|?s)\s*$/i,'')
    .replace(/\s*\((?:ps4|ps5|ps4\s*&\s*ps5|playstation\s*4|playstation\s*5|xbox\s*one|xbox\s*series\s*x\|?s)\)\s*$/i,'')
    .replace(/\s+(?:ps4\s*&\s*ps5|ps4|ps5)\s*$/i,'')
    .replace(/\s*\((?:game preview|preview)\)\s*$/i,'')
    .replace(/\s+(?:game preview)\s*$/i,'')
    .trim();
}

function titleVariants(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const stripped = stripStoreSuffix(raw);
  return uniq([normalizeTitle(raw), normalizeTitle(stripped)]).filter(Boolean);
}

function gameTitleVariants(game = {}) {
  return uniq([game.name, ...(game.aliases || [])].flatMap(titleVariants));
}

function buildUniqueGameIndex(games = []) {
  const buckets = new Map();
  games.forEach((game, index) => {
    for (const key of gameTitleVariants(game)) {
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(index);
    }
  });
  const unique = new Map();
  const ambiguous = new Set();
  for (const [key, indexes] of buckets) {
    if (indexes.size === 1) unique.set(key, [...indexes][0]);
    else ambiguous.add(key);
  }
  return { unique, ambiguous };
}

function xboxProductId(game = {}) {
  const direct = String(game.subscriptions?.gamePassProductId || '').trim().toUpperCase();
  if (direct) return direct;
  const source = [
    game.links?.xbox,
    game.links?.microsoft,
    game.xboxUrl,
    game.microsoftUrl
  ].filter(Boolean).join(' ');
  return source.match(/\b([A-Z0-9]{10,16})\b/i)?.[1]?.toUpperCase() || '';
}

async function requestJson(path, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers:{ accept:'application/json' },
      signal:controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0,240)}`);
    return JSON.parse(text);
  } catch (error) {
    if (attempt >= 2) throw error;
    await sleep(800 * (attempt + 1));
    return requestJson(path, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGamePass() {
  const kinds = ['console','pc','cloud'];
  const merged = new Map();
  for (const kind of kinds) {
    const payload = await requestJson(`/gamepass/${kind}?limit=5000`);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const id = String(item?.providerId || '').trim().toUpperCase();
      const title = String(item?.title || '').trim();
      if (!id || !title) continue;
      if (!merged.has(id)) merged.set(id, {
        id, title, console:false, pc:false, cloud:false
      });
      merged.get(id)[kind] = true;
    }
  }
  return [...merged.values()];
}

async function fetchGeforceNow() {
  const payload = await requestJson('/gfn/catalog?pages=30');
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map(item => ({
      id:String(item?.providerId || '').trim(),
      title:String(item?.title || '').trim()
    }))
    .filter(item => item.id && item.title);
}

function matchCatalogToGames(items, games, index) {
  const byGame = new Map();
  let ambiguous = 0;
  let unmatched = 0;

  for (const item of items) {
    const candidates = new Set();
    let hitAmbiguous = false;
    for (const key of titleVariants(item.title)) {
      if (index.ambiguous.has(key)) hitAmbiguous = true;
      const gameIndex = index.unique.get(key);
      if (gameIndex != null) candidates.add(gameIndex);
    }
    if (candidates.size !== 1) {
      if (hitAmbiguous || candidates.size > 1) ambiguous += 1;
      else unmatched += 1;
      continue;
    }
    const gameIndex = [...candidates][0];
    if (!byGame.has(gameIndex)) byGame.set(gameIndex, []);
    byGame.get(gameIndex).push(item);
  }

  return { byGame, ambiguous, unmatched };
}

function subscriptionCounts(games = []) {
  return {
    gamePass:games.filter(game => game.subscriptions?.gamePass).length,
    gamePassConsole:games.filter(game => game.subscriptions?.gamePassConsole).length,
    gamePassPc:games.filter(game => game.subscriptions?.gamePassPc).length,
    cloudGaming:games.filter(game => game.subscriptions?.cloudGaming).length,
    psPlus:games.filter(game => game.subscriptions?.psPlus).length,
    geforceNow:games.filter(game => game.subscriptions?.geforceNow).length,
    none:games.filter(game => {
      const s = game.subscriptions || {};
      return !s.gamePass && !s.psPlus && !s.geforceNow && !s.eaPlay;
    }).length
  };
}

function applyGamePass(games, catalog, match) {
  const byId = new Map(catalog.map(item => [item.id, item]));
  const checkedAt = new Date().toISOString();
  let matched = 0;
  let exactIds = 0;

  games.forEach((game, index) => {
    game.subscriptions ||= {};
    let selected = null;
    const id = xboxProductId(game);
    if (id && byId.has(id)) {
      selected = byId.get(id);
      exactIds += 1;
    } else {
      const candidates = match.byGame.get(index) || [];
      if (candidates.length) {
        selected = candidates.reduce((best, item) => {
          if (!best) return item;
          const bestKinds = Number(best.console) + Number(best.pc) + Number(best.cloud);
          const itemKinds = Number(item.console) + Number(item.pc) + Number(item.cloud);
          return itemKinds > bestKinds ? item : best;
        }, null);
      }
    }

    if (selected) {
      game.subscriptions.gamePass = true;
      game.subscriptions.gamePassConsole = Boolean(selected.console);
      game.subscriptions.gamePassPc = Boolean(selected.pc);
      game.subscriptions.cloudGaming = Boolean(selected.cloud);
      game.subscriptions.gamePassCheckedAt = checkedAt;
      game.subscriptions.gamePassSource = 'microsoft-catalog';
      game.subscriptions.gamePassProductId = selected.id;
      matched += 1;
      return;
    }

    const previousSource = String(game.subscriptions.gamePassSource || '');
    const previousId = String(game.subscriptions.gamePassProductId || '').toUpperCase();
    if (previousSource === 'microsoft-catalog' && previousId && !byId.has(previousId)) {
      game.subscriptions.gamePass = false;
      game.subscriptions.gamePassConsole = false;
      game.subscriptions.gamePassPc = false;
      game.subscriptions.cloudGaming = false;
      game.subscriptions.gamePassCheckedAt = checkedAt;
      delete game.subscriptions.gamePassProductId;
    }
  });

  return { matched, exactIds };
}

function applyGeforceNow(games, catalog, match) {
  const byId = new Set(catalog.map(item => item.id));
  const checkedAt = new Date().toISOString();
  let matched = 0;

  games.forEach((game, index) => {
    game.subscriptions ||= {};
    const candidates = match.byGame.get(index) || [];
    const selected = candidates[0] || null;
    if (selected) {
      game.subscriptions.geforceNow = true;
      game.subscriptions.geforceNowCheckedAt = checkedAt;
      game.subscriptions.geforceNowSource = 'nvidia-catalog';
      game.subscriptions.geforceNowGameId = selected.id;
      matched += 1;
      return;
    }

    const previousSource = String(game.subscriptions.geforceNowSource || '');
    const previousId = String(game.subscriptions.geforceNowGameId || '');
    if (previousSource === 'nvidia-catalog' && previousId && !byId.has(previousId)) {
      game.subscriptions.geforceNow = false;
      game.subscriptions.geforceNowCheckedAt = checkedAt;
      delete game.subscriptions.geforceNowGameId;
    }
  });

  return { matched };
}

async function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  const games = Array.isArray(payload?.games) ? payload.games : [];
  if (!games.length) throw new Error('games.json neobsahuje hry.');

  const before = subscriptionCounts(games);
  const index = buildUniqueGameIndex(games);

  const [gamePass, geforceNow] = await Promise.all([
    fetchGamePass(),
    fetchGeforceNow()
  ]);

  if (gamePass.length < 300) throw new Error(`Game Pass katalog je podezřele malý: ${gamePass.length}`);
  if (geforceNow.length < 1000) throw new Error(`GeForce NOW katalog je podezřele malý: ${geforceNow.length}`);

  const gamePassMatch = matchCatalogToGames(gamePass, games, index);
  const geforceMatch = matchCatalogToGames(geforceNow, games, index);
  const gp = applyGamePass(games, gamePass, gamePassMatch);
  const gfn = applyGeforceNow(games, geforceNow, geforceMatch);
  const after = subscriptionCounts(games);

  console.log('🎟️ Subscription enrichment', {
    dryRun:DRY_RUN,
    catalog:{
      gamePass:gamePass.length,
      geforceNow:geforceNow.length
    },
    matched:{
      gamePass:gp.matched,
      gamePassExactIds:gp.exactIds,
      geforceNow:gfn.matched
    },
    skipped:{
      gamePassAmbiguous:gamePassMatch.ambiguous,
      gamePassUnmatched:gamePassMatch.unmatched,
      geforceAmbiguous:geforceMatch.ambiguous,
      geforceUnmatched:geforceMatch.unmatched
    },
    before,
    after
  });

  if (after.gamePass < before.gamePass) throw new Error(`Game Pass count regressed: ${before.gamePass} → ${after.gamePass}`);
  if (after.geforceNow < before.geforceNow) throw new Error(`GeForce NOW count regressed: ${before.geforceNow} → ${after.geforceNow}`);

  if (!DRY_RUN) {
    payload.generatedAt = new Date().toISOString();
    payload.provider = String(payload.provider || '').includes('subscription catalogs')
      ? payload.provider
      : [payload.provider, 'official subscription catalogs'].filter(Boolean).join(' + ');
    await atomicWrite(INPUT, JSON.stringify(payload, null, 2) + '\n');
  }
}

module.exports = {
  normalizeTitle,
  stripStoreSuffix,
  titleVariants,
  buildUniqueGameIndex,
  matchCatalogToGames,
  subscriptionCounts
};

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Subscription enrichment failed.');
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}
