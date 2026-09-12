#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const EN_WIKI_API = 'https://en.wikipedia.org/w/api.php';
const GAMEPASS_SIGLS = 'https://catalog.gamepass.com/sigls/v2';
const DISPLAY_CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0/products';
const STEAM_APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const USER_AGENT = 'GameS-Calendar/3.3 (https://caseycz.github.io/GameS-Calendar-Website/; public metadata enrichment)';

const GAMEPASS_LISTS = {
  console: ['f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e'],
  pc: [
    '609d944c-d395-4c0a-9ea4-e9f39b52c1ad',
    'fdd9e2a7-0fee-49f6-ad69-4354098401ff'
  ],
  cloud: ['29a81209-df6f-41fd-a528-2ae6b91f719c']
};

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
    .replace(/\b(xbox series x s|xbox series|xbox one|windows 10|windows 11|playstation 4|playstation 5|ps4|ps5)\b/g, ' ')
    .replace(/\b(standard|deluxe|ultimate|complete|premium|definitive|collector s|collectors|cross gen|cross gen bundle) edition\b/g, ' ')
    .replace(/\b(game preview|preview)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return uniq([base, cleaned]);
}

function shortText(value, max = 640) {
  const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function canReplaceSummary(game) {
  const source = String(game.summarySource || '').toLowerCase();
  return isGeneratedSummary(game) || !game.summary || source.startsWith('wikipedia') || source === 'wikidata';
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

function steamIdFromGame(game) {
  if (game.steamId) return String(game.steamId);
  const match = String(game.links?.steam || '').match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match?.[1] || '';
}

async function enrichSteamOfficial(games) {
  let matched = 0;
  let improvedDescriptions = 0;
  let improvedGenres = 0;

  for (const game of games) {
    const steamId = steamIdFromGame(game);
    if (!steamId) continue;
    const url = new URL(STEAM_APPDETAILS);
    url.searchParams.set('appids', steamId);
    url.searchParams.set('cc', 'cz');
    url.searchParams.set('l', 'english');

    try {
      const payload = await requestJson(url);
      const data = payload?.[steamId]?.success ? payload[steamId].data : null;
      if (!data) continue;
      matched += 1;
      game.steamId = steamId;
      game.metadataSources = uniq([...(game.metadataSources || []), 'steam']);

      const steamGenres = uniq((data.genres || []).map(item => item?.description).filter(Boolean));
      const steamCategories = uniq((data.categories || []).map(item => item?.description).filter(Boolean));
      if (steamGenres.length) {
        const before = (game.genres || []).length;
        game.genres = uniq([...(game.genres || []), ...steamGenres]);
        if (game.genres.length > before) improvedGenres += 1;
      }
      if (steamCategories.length) game.storeCategories = uniq([...(game.storeCategories || []), ...steamCategories]);

      game.developers = uniq([...(game.developers || []), ...(data.developers || [])]);
      game.publishers = uniq([...(game.publishers || []), ...(data.publishers || [])]);
      if (!game.cover && data.header_image) game.cover = data.header_image;
      if (data.name && normalize(data.name) !== normalize(game.name)) game.aliases = uniq([...(game.aliases || []), data.name]);

      const description = shortText(data.short_description || data.detailed_description || '');
      if (description && canReplaceSummary(game)) {
        game.summary = description;
        game.summarySource = 'steam-store';
        improvedDescriptions += 1;
      }

      if ((!game.screenshots || !game.screenshots.length) && data.screenshots?.length) {
        game.screenshots = data.screenshots.slice(0, 10).map(item => ({
          full: item.path_full || '',
          thumb: item.path_thumbnail || item.path_full || ''
        })).filter(item => item.full);
      }

      if (!game.trailerId && !game.trailerUrl && data.movies?.length) {
        const movie = data.movies[0];
        game.trailerUrl = movie?.mp4?.max || movie?.mp4?.['480'] || '';
        game.trailerPoster = movie?.thumbnail || '';
      }
    } catch (error) {
      console.warn(`⚠️ Steam ${game.name}: ${error.message}`);
    }
    await sleep(120);
  }

  return { matched, improvedDescriptions, improvedGenres };
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
    if (!canReplaceSummary(game)) continue;
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
          if (!canReplaceSummary(game)) continue;
          game.summary = extract;
          game.summarySource = 'wikipedia-en';
          game.metadataSources = uniq([...(game.metadataSources || []), 'wikipedia-en']);
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

async function fetchGamePassLists() {
  const sets = { console: new Set(), pc: new Set(), cloud: new Set() };
  let successfulLists = 0;
  let requestedLists = 0;

  for (const [kind, ids] of Object.entries(GAMEPASS_LISTS)) {
    for (const listId of ids) {
      requestedLists += 1;
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
          if (id) { sets[kind].add(String(id)); added += 1; }
        }
        if (added) successfulLists += 1;
      } catch (error) {
        console.warn(`⚠️ Game Pass ${kind} ${listId}: ${error.message}`);
      }
      await sleep(120);
    }
  }

  return { sets, successfulLists, requestedLists };
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

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === 'string' ? item : item?.Name || item?.name || item?.DisplayName || item?.displayName).filter(Boolean);
}

function productEntry(product) {
  const localized = product?.LocalizedProperties?.[0] || product?.localizedProperties?.[0] || {};
  const properties = product?.Properties || product?.properties || {};
  const title = localized.ProductTitle || localized.productTitle || '';
  if (!title) return null;

  const categories = uniq([
    ...arrayOfStrings(properties.Categories || properties.categories),
    ...arrayOfStrings(localized.Categories || localized.categories),
    typeof properties.Category === 'string' ? properties.Category : '',
    typeof properties.category === 'string' ? properties.category : ''
  ]);

  return {
    id: String(product.ProductId || product.productId || ''),
    title,
    description: shortText(localized.ShortDescription || localized.shortDescription || localized.ProductDescription || localized.productDescription || ''),
    developer: localized.DeveloperName || localized.developerName || '',
    publisher: localized.PublisherName || localized.publisherName || '',
    categories
  };
}

function buildProductIndex(products) {
  const index = new Map();
  const byId = new Map();
  for (const product of products) {
    const entry = productEntry(product);
    if (!entry) continue;
    if (entry.id) byId.set(entry.id, entry);
    for (const key of titleVariants(entry.title)) if (key && !index.has(key)) index.set(key, entry);
  }
  return { index, byId };
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
  const { sets, successfulLists, requestedLists } = await fetchGamePassLists();
  const unionIds = uniq([...sets.console, ...sets.pc, ...sets.cloud]);
  console.log(`🎟️ Microsoft Game Pass: konzole ${sets.console.size}, PC ${sets.pc.size}, cloud ${sets.cloud.size}; ${successfulLists}/${requestedLists} seznamů.`);

  if (!successfulLists || unionIds.length < 50) {
    console.warn('⚠️ Game Pass katalog nevypadá kompletně; stávající hodnoty ponechávám.');
    return {
      matched: games.filter(game => game.subscriptions?.gamePass).length,
      cloud: games.filter(game => game.subscriptions?.cloudGaming).length,
      improvedDescriptions: 0,
      improvedGenres: 0,
      reliable: false
    };
  }

  const products = await fetchMicrosoftProducts(unionIds);
  const { index } = buildProductIndex(products);
  console.log(`🎟️ Microsoft DisplayCatalog: ${products.length} produktů, ${index.size} názvových klíčů.`);
  if (index.size < 50) {
    console.warn('⚠️ DisplayCatalog nevypadá kompletně; stávající hodnoty ponechávám.');
    return {
      matched: games.filter(game => game.subscriptions?.gamePass).length,
      cloud: games.filter(game => game.subscriptions?.cloudGaming).length,
      improvedDescriptions: 0,
      improvedGenres: 0,
      reliable: false
    };
  }

  let matched = 0;
  let cloud = 0;
  let improvedDescriptions = 0;
  let improvedGenres = 0;
  const checkedAt = new Date().toISOString();

  for (const game of games) {
    const product = findProduct(game, index);
    game.subscriptions = game.subscriptions || {};

    if (!product?.id) {
      game.subscriptions.gamePass = false;
      game.subscriptions.gamePassConsole = false;
      game.subscriptions.gamePassPc = false;
      game.subscriptions.cloudGaming = false;
      game.subscriptions.gamePassCheckedAt = checkedAt;
      game.subscriptions.gamePassSource = 'microsoft-catalog';
      delete game.subscriptions.gamePassProductId;
      continue;
    }

    const onConsole = sets.console.has(product.id);
    const onPc = sets.pc.has(product.id);
    const onCloud = sets.cloud.has(product.id);
    const onGamePass = onConsole || onPc || onCloud;

    game.subscriptions.gamePass = onGamePass;
    game.subscriptions.gamePassConsole = onConsole;
    game.subscriptions.gamePassPc = onPc;
    game.subscriptions.cloudGaming = onCloud;
    game.subscriptions.gamePassCheckedAt = checkedAt;
    game.subscriptions.gamePassSource = 'microsoft-catalog';
    game.subscriptions.gamePassProductId = product.id;
    game.metadataSources = uniq([...(game.metadataSources || []), 'microsoft-store']);

    if (onGamePass) matched += 1;
    if (onCloud) cloud += 1;

    if (product.description && canReplaceSummary(game)) {
      game.summary = product.description;
      game.summarySource = 'microsoft-store';
      improvedDescriptions += 1;
    }
    if (product.developer) game.developers = uniq([...(game.developers || []), product.developer]);
    if (product.publisher) game.publishers = uniq([...(game.publishers || []), product.publisher]);
    if (product.categories.length) {
      const before = (game.genres || []).length;
      game.genres = uniq([...(game.genres || []), ...product.categories]);
      if (game.genres.length > before) improvedGenres += 1;
    }
  }

  return { matched, cloud, improvedDescriptions, improvedGenres, reliable: true };
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
  const steam = await enrichSteamOfficial(games);
  const gp = await enrichGamePass(games);
  const wikiImproved = await enrichEnglishWikipedia(games);
  const generatedAfter = games.filter(isGeneratedSummary).length;
  const withSummary = games.filter(game => String(game.summary || '').trim()).length;

  payload.provider = 'IGDB release data + official Steam/Xbox metadata + Microsoft Game Pass/Cloud catalog + Wikidata/Wikipedia fallback + official subscription catalogs';
  payload.generatedAt = new Date().toISOString();
  await atomicWrite(OUTPUT, JSON.stringify(payload, null, 2) + '\n');

  console.log(`🛒 Steam: ${steam.matched} her · ${steam.improvedDescriptions} popisů · ${steam.improvedGenres} doplnění žánrů.`);
  console.log(`🎟️ Game Pass: ${gp.matched}/${games.length} · Cloud Gaming: ${gp.cloud}/${games.length}${gp.reliable ? ' (Microsoft katalog)' : ' (původní hodnoty)'}.`);
  console.log(`📝 Popisy: ${withSummary}/${games.length}; generických ${generatedBefore} → ${generatedAfter}; Microsoft ${gp.improvedDescriptions}, Steam ${steam.improvedDescriptions}, EN Wikipedia fallback ${wikiImproved}.`);
}

main().catch(error => {
  console.error('❌ Doplňkové veřejné obohacení selhalo.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
