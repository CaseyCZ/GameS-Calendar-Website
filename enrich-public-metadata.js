#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const EN_WIKI_API = 'https://en.wikipedia.org/w/api.php';
const GAMEPASS_SIGLS = 'https://catalog.gamepass.com/sigls/v2';
const DISPLAY_CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0/products';
const USER_AGENT = 'GameS-Calendar/3.2 (https://caseycz.github.io/GameS-Calendar-Website/; public metadata enrichment)';
const GAMEPASS_LIST_IDS = [
  'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
  'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
  '29a81209-df6f-41fd-a528-2ae6b91f719c',
  '609d944c-d395-4c0a-9ea4-e9f39b52c1ad'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uniq = values => [...new Set((values || []).filter(Boolean))];

function normalize(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleVariants(value = '') {
  const base = normalize(value);
  if (!base) return [];
  const cleaned = base
    .replace(/\b(xbox series x s|xbox series|xbox one|windows 10|windows 11)\b/g, ' ')
    .replace(/\b(standard|deluxe|ultimate|complete|premium|definitive|collector s|collectors) edition\b/g, ' ')
    .replace(/\b(game preview|preview)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return uniq([base, cleaned]);
}

function shortText(value, max = 560) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence > max * .5) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : max)}…`;
}

function isGeneratedSummary(game) {
  const text = String(game.summary || '').trim();
  if (!text) return true;
  const name = String(game.name || '').trim();
  if (!name || !text.toLowerCase().startsWith(name.toLowerCase())) return false;
  return /\bje (videohra|hra z kategorie)\b/i.test(text) && /datum vydání:/i.test(text);
}

async function requestJson(url, attempt = 0) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain;q=.9,*/*;q=.5' }
  });
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await sleep(700 * (2 ** attempt));
      return requestJson(url, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0,180)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`Neplatný JSON z ${url}`); }
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function englishWikiTitle(game) {
  const url = String(game.links?.wikipedia || '');
  if (!/https:\/\/en\.wikipedia\.org\/wiki\//i.test(url)) return '';
  const raw = url.split('/wiki/')[1]?.split(/[?#]/)[0] || '';
  try { return decodeURIComponent(raw).replace(/_/g, ' '); }
  catch { return raw.replace(/_/g, ' '); }
}

async function enrichEnglishWikipedia(games) {
  const titleToGames = new Map();
  for (const game of games) {
    if (!isGeneratedSummary(game)) continue;
    const title = englishWikiTitle(game);
    if (!title) continue;
    if (!titleToGames.has(title)) titleToGames.set(title, []);
    titleToGames.get(title).push(game);
  }

  let improved = 0;
  for (const batch of chunks([...titleToGames.keys()], 20)) {
    const url = new URL(EN_WIKI_API);
    Object.entries({
      action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', redirects: '1',
      titles: batch.join('|'), format: 'json', formatversion: '2', origin: '*'
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const payload = await requestJson(url);
      for (const page of payload?.query?.pages || []) {
        const extract = shortText(page.extract || '');
        if (!extract) continue;
        const targets = titleToGames.get(page.title) || [];
        for (const game of targets) {
          game.summary = extract;
          game.summarySource = 'wikipedia-en';
          improved += 1;
        }
      }
    } catch (error) {
      console.warn(`⚠️ English Wikipedia: ${error.message}`);
    }
    await sleep(100);
  }
  return improved;
}

async function fetchGamePassIds() {
  const ids = new Set();
  let successfulLists = 0;
  for (const listId of GAMEPASS_LIST_IDS) {
    const url = new URL(GAMEPASS_SIGLS);
    url.searchParams.set('id', listId);
    url.searchParams.set('language', 'en-us');
    url.searchParams.set('market', 'CZ');
    try {
      const payload = await requestJson(url);
      if (!Array.isArray(payload)) continue;
      let added = 0;
      for (const item of payload) {
        const id = item?.id || item?.Id;
        if (id) { ids.add(String(id)); added += 1; }
      }
      if (added) successfulLists += 1;
    } catch (error) {
      console.warn(`⚠️ Game Pass seznam ${listId}: ${error.message}`);
    }
    await sleep(120);
  }
  return { ids: [...ids], successfulLists };
}

async function fetchMicrosoftProducts(ids) {
  const products = [];
  for (const batch of chunks(ids, 20)) {
    const url = new URL(DISPLAY_CATALOG);
    url.searchParams.set('bigIds', batch.join(','));
    url.searchParams.set('market', 'CZ');
    url.searchParams.set('languages', 'en-us');
    url.searchParams.set('fieldsTemplate', 'Details');
    url.searchParams.set('MS-CV', 'GameSCalendar.1');
    try {
      const payload = await requestJson(url);
      products.push(...(payload?.Products || payload?.products || []));
    } catch (error) {
      console.warn(`⚠️ Microsoft katalog (${batch.length}): ${error.message}`);
    }
    await sleep(100);
  }
  return products;
}

function productEntry(product) {
  const localized = product?.LocalizedProperties?.[0] || product?.localizedProperties?.[0] || {};
  const title = localized.ProductTitle || localized.productTitle || '';
  if (!title) return null;
  return {
    id: product.ProductId || product.productId || '',
    title,
    shortDescription: shortText(localized.ShortDescription || localized.shortDescription || localized.ProductDescription || localized.productDescription || '')
  };
}

function buildProductIndex(products) {
  const index = new Map();
  for (const product of products) {
    const entry = productEntry(product);
    if (!entry) continue;
    for (const key of titleVariants(entry.title)) if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

function findProduct(game, index) {
  const names = [game.name, ...(game.aliases || [])];
  for (const name of names) {
    for (const key of titleVariants(name)) {
      const hit = index.get(key);
      if (hit) return hit;
    }
  }
  return null;
}

async function enrichGamePass(games) {
  const { ids, successfulLists } = await fetchGamePassIds();
  console.log(`🎟️ Microsoft Game Pass: ${ids.length} unikátních produktových ID z ${successfulLists}/${GAMEPASS_LIST_IDS.length} seznamů.`);
  if (!successfulLists || ids.length < 50) {
    console.warn('⚠️ Game Pass katalog nevypadá kompletně; stávající hodnoty ponechávám.');
    return { matched: games.filter(game => game.subscriptions?.gamePass).length, improvedDescriptions: 0, reliable: false };
  }

  const products = await fetchMicrosoftProducts(ids);
  const index = buildProductIndex(products);
  console.log(`🎟️ Microsoft DisplayCatalog: ${products.length} produktů, ${index.size} názvových klíčů.`);
  if (index.size < 50) {
    console.warn('⚠️ DisplayCatalog nevypadá kompletně; stávající hodnoty ponechávám.');
    return { matched: games.filter(game => game.subscriptions?.gamePass).length, improvedDescriptions: 0, reliable: false };
  }

  let matched = 0;
  let improvedDescriptions = 0;
  const checkedAt = new Date().toISOString();
  for (const game of games) {
    const product = findProduct(game, index);
    game.subscriptions = game.subscriptions || {};
    game.subscriptions.gamePass = Boolean(product);
    game.subscriptions.gamePassCheckedAt = checkedAt;
    game.subscriptions.gamePassSource = 'microsoft-catalog';
    if (product) {
      matched += 1;
      game.subscriptions.gamePassProductId = product.id || '';
      if (product.shortDescription && isGeneratedSummary(game)) {
        game.summary = product.shortDescription;
        game.summarySource = 'microsoft-store';
        improvedDescriptions += 1;
      }
    } else {
      delete game.subscriptions.gamePassProductId;
    }
  }
  return { matched, improvedDescriptions, reliable: true };
}

async function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const games = Array.isArray(payload?.games) ? payload.games : [];
  if (!games.length) throw new Error('games.json neobsahuje hry.');

  const generatedBefore = games.filter(isGeneratedSummary).length;
  const wikiImproved = await enrichEnglishWikipedia(games);
  const gp = await enrichGamePass(games);
  const generatedAfter = games.filter(isGeneratedSummary).length;
  const withSummary = games.filter(game => String(game.summary || '').trim()).length;

  payload.provider = 'IGDB release data + Wikidata/Wikipedia (CS/EN) + Steam + Microsoft Game Pass catalog + official subscription catalogs';
  payload.generatedAt = new Date().toISOString();
  await atomicWrite(OUTPUT, JSON.stringify(payload, null, 2) + '\n');

  console.log(`📝 Popisy: ${withSummary}/${games.length}; generických ${generatedBefore} → ${generatedAfter}; EN Wikipedia doplnila ${wikiImproved}, Microsoft Store ${gp.improvedDescriptions}.`);
  console.log(`🎟️ Game Pass: ${gp.matched}/${games.length}${gp.reliable ? ' (Microsoft katalog)' : ' (původní hodnoty)'}.`);
}

main().catch(error => {
  console.error('❌ Doplňkové veřejné obohacení selhalo.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
