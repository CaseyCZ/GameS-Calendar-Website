import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';

const BASE = 'https://web.np.playstation.com/api/graphql/v1/op';
const COMMERCIAL_KEY = /price|currency|discount|msrp/i;
const COMMERCIAL_MARKER = /price|currency|discount|msrp/i;

export const CATEGORY_IDS = Object.freeze({
  ps4: '44d8bb20-653e-431e-8ad0-c0a365f68d2f',
  ps5: '4cbf39e2-5749-4970-ba81-93a489e4570c',
  psPlus: '038b4df3-bb4c-48f8-8290-3feb35f0f0fd',
  sales: '803cee19-e5a1-4d59-a463-0b6b2701bf7c',
  vr: '95239ca7-2dcf-43d9-8d4b-b7672ee9304a',
  vr2: '62c2a3b6-41cf-4808-ba48-1e5581eeea35',
  free: 'd9930400-c5c7-4a06-a28d-cc74888426dc',
  new: 'e1699f77-77e1-43ca-a296-26d08abacb0f',
  all: '28c9c2b2-cecc-415c-9a08-482a605cb104'
});

const DEFAULT_HASHES = Object.freeze({
  categoryGridRetrieve: '4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35',
  featuresRetrieve: '010870e8b9269c5bcf06b60190edbf5229310d8fae5b86515ad73f05bd11c4d1',
  metGetProductById: 'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a',
  metGetConceptById: 'cc90404ac049d935afbd9968aef523da2b6723abfb9d586e5f77ebf7c5289006',
  conceptRetrieveForMedia: '615a2c4618229aa2f11c10fe497eaf4fdc151e4dcc0b6b82e154aeacb0123c2d'
});

const HASHES = Object.freeze({
  categoryGridRetrieve: process.env.PS_HASH_CATEGORY_GRID_RETRIEVE || DEFAULT_HASHES.categoryGridRetrieve,
  featuresRetrieve: process.env.PS_HASH_FEATURES_RETRIEVE || DEFAULT_HASHES.featuresRetrieve,
  metGetProductById: process.env.PS_HASH_MET_GET_PRODUCT_BY_ID || DEFAULT_HASHES.metGetProductById,
  metGetConceptById: process.env.PS_HASH_MET_GET_CONCEPT_BY_ID || DEFAULT_HASHES.metGetConceptById,
  conceptRetrieveForMedia: process.env.PS_HASH_MEDIA_BY_CONCEPT || DEFAULT_HASHES.conceptRetrieveForMedia
});

function stripCommercial(value) {
  if (Array.isArray(value)) return value.map(stripCommercial).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;

  const marker = `${value.name || ''} ${value.displayName || ''}`;
  if (COMMERCIAL_MARKER.test(marker)) return undefined;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (COMMERCIAL_KEY.test(key)) continue;
    const safe = stripCommercial(child);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

async function persisted(operationName, variables, { force = false } = {}) {
  const hash = HASHES[operationName];
  if (!hash) throw new Error(`Missing PlayStation persisted-query hash for ${operationName}`);
  const key = `playstation:${operationName}:${config.psLocale}:${JSON.stringify(variables)}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return stripCommercial(cached);
  }
  const url = new URL(BASE);
  url.searchParams.set('operationName', operationName);
  url.searchParams.set('variables', JSON.stringify(variables));
  url.searchParams.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
  const payload = await fetchJson(url, {
    headers: {
      'x-psn-store-locale-override': config.psLocale,
      'content-type': 'application/json'
    }
  });
  if (payload?.errors?.length) {
    const error = payload.errors.map(item => item?.message || 'GraphQL error').join('; ');
    throw new Error(`PlayStation ${operationName}: ${error}`);
  }
  const safePayload = stripCommercial(payload);
  return cachePut(key, 'playstation', safePayload, config.ttl.product);
}

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) value.forEach(item => walk(item, visitor));
  else Object.values(value).forEach(item => walk(item, visitor));
}

function firstString(root, keys) {
  let found = '';
  walk(root, node => {
    if (found || Array.isArray(node)) return;
    for (const key of keys) {
      const value = node?.[key];
      if (typeof value === 'string' && value.trim()) { found = value.trim(); return; }
    }
  });
  return found;
}

function firstNumber(root, keys) {
  let found = null;
  walk(root, node => {
    if (found != null || Array.isArray(node)) return;
    for (const key of keys) {
      const value = node?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) { found = value; return; }
    }
  });
  return found;
}

function collectStrings(root, keys) {
  const values = [];
  walk(root, node => {
    if (Array.isArray(node)) return;
    for (const key of keys) {
      const value = node?.[key];
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') values.push(item);
          else if (typeof item?.name === 'string') values.push(item.name);
        }
      }
    }
  });
  return uniq(values.map(cleanText).filter(Boolean));
}

function collectImages(root) {
  const values = [];
  walk(root, node => {
    if (Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && /(image|url|src|master|hero|cover|thumbnail)/i.test(key)) values.push(value);
    }
  });
  return uniq(values.filter(url => /image|akamai|playstation|sndcdn|sony/i.test(url)));
}

function normalizePsPayload(providerId, payload, sourceUrl = BASE) {
  const title = firstString(payload, ['name', 'title', 'productName', 'conceptName']);
  const description = firstString(payload, ['longDescription', 'description', 'shortDescription']);
  const publisher = firstString(payload, ['publisherName', 'publisher']);
  const releaseDate = firstString(payload, ['releaseDate', 'releaseDateTime', 'productReleaseDate']);
  const platforms = collectStrings(payload, ['platform', 'platforms', 'platformType', 'platformNames', 'targetPlatforms']).filter(v => /PS4|PS5|PlayStation/i.test(v));
  const genres = collectStrings(payload, ['genres', 'genre', 'productGenres']);
  const images = collectImages(payload);
  const ratingText = firstString(payload, ['averageRating', 'starRating']);
  const ratingNumber = firstNumber(payload, ['averageRating', 'starRating']);
  const ratingCount = firstNumber(payload, ['ratingCount', 'starRatingCount', 'totalRatingsCount']);
  return canonicalGame('playstation', {
    providerId,
    title,
    description: cleanText(description),
    shortDescription: cleanText(firstString(payload, ['shortDescription'])),
    publishers: publisher ? [publisher] : [],
    genres,
    categories: genres,
    platforms,
    releaseDate,
    rating: Number(ratingText || ratingNumber || 0) || null,
    ratingCount,
    media: { cover: images[0] || '', hero: images[1] || '', screenshots: images.slice(2, 18) },
    storeUrl: providerId ? `https://store.playstation.com/${config.psLocale}/product/${providerId}` : '',
    sourceUrl,
    rawHints: { operation: payload?.data ? 'graphql' : 'html' }
  });
}

export async function product(productId, { force = false } = {}) {
  const payload = await persisted('metGetProductById', { productId: String(productId) }, { force });
  return normalizePsPayload(String(productId), payload);
}

export async function concept(conceptId, { force = false } = {}) {
  const id = String(conceptId);
  const requests = await Promise.allSettled([
    persisted('metGetConceptById', { conceptId: id }, { force }),
    persisted('conceptRetrieveForMedia', { conceptId: id }, { force })
  ]);
  const payloads = requests.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!payloads.length) throw requests.find(result => result.status === 'rejected')?.reason || new Error('PlayStation concept failed');
  const normalized = normalizePsPayload(id, { payloads });
  normalized.storeUrl = `https://store.playstation.com/${config.psLocale}/concept/${id}`;
  return normalized;
}

export async function catalog(category = 'all', { force = false, size = 100, offset = 0 } = {}) {
  const id = CATEGORY_IDS[category] || category;
  const pageSize = Math.max(1, Math.min(1000, Number(size) || 100));
  const pageOffset = Math.max(0, Number(offset) || 0);
  return persisted('categoryGridRetrieve', {
    id,
    pageArgs: { size: pageSize, offset: pageOffset },
    sortBy: { name: 'productReleaseDate', isAscending: false },
    filterBy: [],
    facetOptions: []
  }, { force });
}

function categoryProducts(payload) {
  const products = payload?.data?.categoryGridRetrieve?.products;
  return Array.isArray(products) ? products : [];
}

export async function catalogProducts(category = 'all', { force = false, size = 200, maxPages = 10 } = {}) {
  const pageSize = Math.max(1, Math.min(1000, Number(size) || 200));
  const pages = Math.max(1, Math.min(50, Number(maxPages) || 10));
  const out = [];
  const seen = new Set();

  for (let page = 0; page < pages; page += 1) {
    const payload = await catalog(category, { force, size: pageSize, offset: page * pageSize });
    const products = categoryProducts(payload);
    for (const raw of products) {
      const id = String(raw?.id || raw?.productId || raw?.npTitleId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const item = normalizePsPayload(id, raw);
      if (item?.title) out.push(item);
    }
    if (products.length < pageSize) break;
  }
  return out;
}

export async function psPlusCatalog(options = {}) {
  const items = await catalogProducts('psPlus', options);
  return items.map(item => ({
    ...item,
    subscriptions: { ...(item.subscriptions || {}), psPlus: true }
  }));
}

export async function psPlus(tier = 'TIER_20', { force = false } = {}) {
  const allowed = new Set(['TIER_10', 'TIER_20', 'TIER_30']);
  const tierLabel = allowed.has(tier) ? tier : 'TIER_20';
  return persisted('featuresRetrieve', { tierLabel }, { force });
}

export async function search(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `playstation:html-search:${config.psLocale}:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  const url = `https://store.playstation.com/${config.psLocale}/search/${encodeURIComponent(q)}`;
  const html = await fetchText(url);
  const $ = loadHtml(html);
  const hits = [];
  const seen = new Set();
  $('a[href*="/product/"],a[href*="/concept/"]').each((_, node) => {
    const href = $(node).attr('href') || '';
    const text = cleanText($(node).text() || $(node).attr('aria-label') || '');
    let id = '';
    let kind = '';
    const productMatch = href.match(/\/product\/([^/?#]+)/i);
    const conceptMatch = href.match(/\/concept\/([^/?#]+)/i);
    if (productMatch) { id = productMatch[1]; kind = 'product'; }
    else if (conceptMatch) { id = conceptMatch[1]; kind = 'concept'; }
    if (!id || seen.has(`${kind}:${id}`)) return;
    seen.add(`${kind}:${id}`);
    hits.push({ id, kind, title: text, url: new URL(href, 'https://store.playstation.com').href });
  });
  const out = [];
  for (const hit of hits.slice(0, limit)) {
    try { out.push(hit.kind === 'product' ? await product(hit.id, { force }) : await concept(hit.id, { force })); }
    catch { out.push(canonicalGame('playstation', { providerId: hit.id, title: hit.title, storeUrl: hit.url, sourceUrl: url })); }
  }
  cachePut(key, 'playstation', out, config.ttl.search);
  return out.slice(0, limit);
}

export const playstationProvider = {
  name: 'playstation',
  capabilities: ['search', 'product', 'concept', 'catalog', 'catalogProducts', 'psPlus', 'psPlusCatalog', 'media'],
  search,
  product,
  concept,
  catalog,
  catalogProducts,
  psPlus,
  psPlusCatalog,
  health: async () => {
    const result = await concept('212779', { force: true });
    return { ok: Boolean(result?.title), sample: result?.title || null, locale: config.psLocale };
  },
  hashes: HASHES
};
