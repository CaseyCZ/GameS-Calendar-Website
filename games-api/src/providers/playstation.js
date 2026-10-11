import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, storefrontTitleScore, uniq } from '../lib/normalize.js';

const BASE = 'https://web.np.playstation.com/api/graphql/v1/op';

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
  metGetPricingDataByConceptId: 'abcb311ea830e679fe2b697a27f755764535d825b24510ab1239a4ca3092bd09',
  conceptRetrieveForMedia: '615a2c4618229aa2f11c10fe497eaf4fdc151e4dcc0b6b82e154aeacb0123c2d'
});

const HASHES = Object.freeze({
  categoryGridRetrieve: process.env.PS_HASH_CATEGORY_GRID_RETRIEVE || DEFAULT_HASHES.categoryGridRetrieve,
  featuresRetrieve: process.env.PS_HASH_FEATURES_RETRIEVE || DEFAULT_HASHES.featuresRetrieve,
  metGetProductById: process.env.PS_HASH_MET_GET_PRODUCT_BY_ID || DEFAULT_HASHES.metGetProductById,
  metGetConceptById: process.env.PS_HASH_MET_GET_CONCEPT_BY_ID || DEFAULT_HASHES.metGetConceptById,
  metGetPricingDataByConceptId: process.env.PS_HASH_PRICING_BY_CONCEPT || DEFAULT_HASHES.metGetPricingDataByConceptId,
  conceptRetrieveForMedia: process.env.PS_HASH_MEDIA_BY_CONCEPT || DEFAULT_HASHES.conceptRetrieveForMedia
});

async function persisted(operationName, variables, { force = false } = {}) {
  const hash = HASHES[operationName];
  if (!hash) throw new Error(`Missing PlayStation persisted-query hash for ${operationName}`);
  const key = `playstation:${operationName}:${config.psLocale}:${JSON.stringify(variables)}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
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
  return cachePut(key, 'playstation', payload, config.ttl.product);
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

function parsePriceText(value = '') {
  const raw = cleanText(value);
  if (!raw || /game\s*trial|zdarma|free/i.test(raw)) return null;
  const match = raw.match(/-?\d[\d\s\u00a0.,]*/);
  if (!match) return null;
  let number = match[0].replace(/[\s\u00a0]/g, '');
  const comma = number.lastIndexOf(',');
  const dot = number.lastIndexOf('.');
  if (comma > dot) number = number.replace(/\./g, '').replace(',', '.');
  else if (dot > comma && comma >= 0) number = number.replace(/,/g, '');
  else if (comma >= 0) number = number.replace(',', '.');
  const parsed = Number(number);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectPriceCandidates(root) {
  const out = [];
  walk(root, node => {
    if (!node || Array.isArray(node) || typeof node !== 'object') return;
    const id = cleanText(node.productId || node.id || node.skuId || '');
    const title = cleanText(
      node.name || node.title || node.productName || node.conceptName ||
      node.displayName || node.editionName || node.skuName || ''
    );
    const priceNode = node.price && typeof node.price === 'object' && !Array.isArray(node.price)
      ? node.price
      : node;
    const regularText = [
      priceNode.basePrice, priceNode.formattedBasePrice, priceNode.strikethroughPrice,
      priceNode.regularPrice
    ].find(value => typeof value === 'string' && value.trim()) || '';
    const currentText = [
      priceNode.discountedPrice, priceNode.salePrice, priceNode.formattedDiscountedPrice,
      priceNode.formattedPrice
    ].find(value => typeof value === 'string' && value.trim()) || regularText;
    const regularRaw = [
      priceNode.basePriceValue, priceNode.regularPriceValue,
      typeof priceNode.basePrice === 'number' ? priceNode.basePrice : null,
      typeof priceNode.regularPrice === 'number' ? priceNode.regularPrice : null
    ].find(value => typeof value === 'number' && Number.isFinite(value));
    const currentRaw = [
      priceNode.discountedPriceValue, priceNode.discountedValue, priceNode.salePriceValue,
      typeof priceNode.discountedPrice === 'number' ? priceNode.discountedPrice : null,
      typeof priceNode.salePrice === 'number' ? priceNode.salePrice : null
    ].find(value => typeof value === 'number' && Number.isFinite(value)) ?? regularRaw;
    const regular = parsePriceText(regularText) ?? regularRaw ?? null;
    const current = parsePriceText(currentText) ?? currentRaw ?? regular;
    if (!(Number.isFinite(current) && current > 0) && !(Number.isFinite(regular) && regular > 0)) return;
    out.push({
      id, title,
      regularText: regularText || '',
      currentText: currentText || regularText || '',
      regular: Number.isFinite(regular) ? regular : null,
      current: Number.isFinite(current) ? current : null,
      currency: cleanText(priceNode.currencyCode || priceNode.currency || node.currencyCode || node.currency || '')
    });
  });

  const unique = new Map();
  for (const item of out) {
    const key = `${item.id}|${item.currentText}|${item.current}|${item.currency}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function selectPriceCandidate(root, providerId = '', { preferBase = false, preferredTitle = '' } = {}) {
  const items = collectPriceCandidates(root);
  if (!items.length) return null;
  const requested = String(providerId || '').toUpperCase();
  const wantedTitle = cleanText(preferredTitle);
  const editionText = item => `${item.id} ${item.title}`.toUpperCase();
  const exact = requested
    ? items.find(item => item.id && (String(item.id).toUpperCase() === requested || String(item.id).toUpperCase().startsWith(requested)))
    : null;
  if (exact && !preferBase && !wantedTitle) return exact;

  if (wantedTitle) {
    const matched = items
      .map(item => ({ item, score: storefrontTitleScore(wantedTitle, item.title) }))
      .filter(entry => entry.score >= 0.55)
      .sort((a, b) => b.score - a.score || Number(a.item?.current ?? a.item?.regular ?? Infinity) - Number(b.item?.current ?? b.item?.regular ?? Infinity));
    if (matched[0]?.item) return matched[0].item;
  }

  return [...items].sort((a,b) => {
    const at=editionText(a), bt=editionText(b);
    const aStandard=/STANDARD|BASE/.test(at);
    const bStandard=/STANDARD|BASE/.test(bt);
    const aPremium=/ULTIMATE|DELUXE|PREMIUM|GOLD|COLLECTOR|VAULT|COMPLETE/.test(at);
    const bPremium=/ULTIMATE|DELUXE|PREMIUM|GOLD|COLLECTOR|VAULT|COMPLETE/.test(bt);
    if (preferBase && aStandard !== bStandard) return aStandard ? -1 : 1;
    if (preferBase && aPremium !== bPremium) return aPremium ? 1 : -1;
    const ap=Number(a.current ?? a.regular ?? Infinity);
    const bp=Number(b.current ?? b.regular ?? Infinity);
    return ap-bp;
  })[0] || null;
}

function conceptIdFromProductPayload(root) {
  let found = '';
  walk(root, node => {
    if (found || !node || Array.isArray(node) || typeof node !== 'object') return;
    const concept = node.concept;
    if (!concept || Array.isArray(concept) || typeof concept !== 'object') return;
    const id = cleanText(concept.id || concept.conceptId || '');
    if (/^\d+$/.test(id)) found = id;
  });
  return found;
}

function collectProductReferences(root) {
  const out = new Map();
  walk(root, node => {
    if (!node || Array.isArray(node) || typeof node !== 'object') return;
    const direct = cleanText(node.productId || '');
    const generic = cleanText(node.id || '');
    const id = direct || (/^[A-Z]{2}\d{4}-[A-Z0-9]+_[0-9]{2}-[A-Z0-9]+$/i.test(generic) ? generic : '');
    if (!id) return;
    const title = cleanText(
      node.name || node.title || node.productName || node.displayName ||
      node.editionName || node.skuName || ''
    );
    if (!out.has(id.toUpperCase())) out.set(id.toUpperCase(), { id, title });
  });
  return [...out.values()];
}

function isPurchasableGameTitle(title = '') {
  return !/\b(upgrade|add[- ]?on|dlc|season pass|expansion pass|soundtrack|art ?book|currency|coins?|credits?|points?)\b/i.test(cleanText(title));
}

async function pricedConceptProduct(root, targetTitle, { force = false } = {}) {
  const refs = collectProductReferences(root).slice(0, 16);
  if (!refs.length) return null;

  const results = await Promise.allSettled(refs.map(async ref => {
    const payload = await persisted('metGetProductById', { productId: String(ref.id) }, { force });
    return normalizePsPayload(String(ref.id), payload);
  }));

  return results
    .filter(result => result.status === 'fulfilled' && result.value?.price)
    .map(result => ({
      item: result.value,
      score: storefrontTitleScore(targetTitle, result.value.title)
    }))
    .filter(entry => entry.score >= 0.55 && isPurchasableGameTitle(entry.item.title))
    .sort((a, b) => b.score - a.score || Number(a.item?.price?.current ?? Infinity) - Number(b.item?.price?.current ?? Infinity))[0]?.item || null;
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

function normalizePsPayload(providerId, payload, sourceUrl = BASE, { preferBase = false, preferredTitle = '' } = {}) {
  const title = firstString(payload, ['name', 'title', 'productName', 'conceptName']);
  const description = firstString(payload, ['longDescription', 'description', 'shortDescription']);
  const publisher = firstString(payload, ['publisherName', 'publisher']);
  const releaseDate = firstString(payload, ['releaseDate', 'releaseDateTime', 'productReleaseDate']);
  const platforms = collectStrings(payload, ['platform', 'platforms', 'platformType', 'platformNames']).filter(v => /PS4|PS5|PlayStation/i.test(v));
  const genres = collectStrings(payload, ['genres', 'genre']);
  const images = collectImages(payload);
  const ratingText = firstString(payload, ['averageRating', 'starRating']);
  const ratingNumber = firstNumber(payload, ['averageRating', 'starRating']);
  const ratingCount = firstNumber(payload, ['ratingCount', 'starRatingCount', 'totalRatingsCount']);
  const selectedPrice = selectPriceCandidate(payload, providerId, { preferBase, preferredTitle });
  const regularText = selectedPrice?.regularText || firstString(payload, ['basePrice', 'formattedBasePrice', 'strikethroughPrice']);
  const currentText = selectedPrice?.currentText || firstString(payload, ['discountedPrice', 'salePrice', 'formattedDiscountedPrice']) || regularText;
  const regularValue = selectedPrice?.regular ?? parsePriceText(regularText) ?? firstNumber(payload, ['basePriceValue', 'basePrice', 'regularPriceValue']);
  const currentValue = selectedPrice?.current ?? parsePriceText(currentText) ?? firstNumber(payload, ['discountedPriceValue', 'discountedPrice', 'salePriceValue']) ?? regularValue;
  const currency = selectedPrice?.currency || firstString(payload, ['currencyCode', 'currency']);
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
    price: (regularText || currentText || regularValue != null) ? {
      currency: currency || null,
      current: currentValue,
      regular: regularValue,
      currentText: currentText || null,
      regularText: regularText || null
    } : null,
    media: { cover: images[0] || '', hero: images[1] || '', screenshots: images.slice(2, 18) },
    storeUrl: providerId ? `https://store.playstation.com/${config.psLocale}/product/${providerId}` : '',
    sourceUrl,
    rawHints: {
      operation: payload?.data ? 'graphql' : 'html',
      priceProductId: selectedPrice?.id || null,
      priceEdition: selectedPrice?.id && /STANDARD|BASE/i.test(selectedPrice.id) ? 'standard'
        : selectedPrice?.id && /ULTIMATE|DELUXE|PREMIUM|GOLD|COLLECTOR|VAULT/i.test(selectedPrice.id) ? 'premium'
        : null
    }
  });
}

export async function product(productId, { force = false } = {}) {
  const id = String(productId);
  const payload = await persisted('metGetProductById', { productId: id }, { force });
  let normalized = normalizePsPayload(id, payload);

  if (!normalized.price) {
    const conceptId = conceptIdFromProductPayload(payload);
    if (conceptId) {
      try {
        const pricing = await persisted('metGetPricingDataByConceptId', { conceptId }, { force });
        const priced = normalizePsPayload(id, { payloads: [payload, pricing] });
        if (priced?.price) {
          normalized.price = { ...priced.price };
          normalized.rawHints = {
            ...(normalized.rawHints || {}),
            priceProductId: priced.rawHints?.priceProductId || id,
            priceEdition: priced.rawHints?.priceEdition || null,
            priceFallback: 'product-concept-pricing',
            priceConceptId: conceptId
          };
        }
      } catch {}
    }
  }

  return applyPsPlusMembership(normalized, { force });
}

export async function concept(conceptId, { force = false, preferredTitle = '' } = {}) {
  const id = String(conceptId);
  const requests = await Promise.allSettled([
    persisted('metGetConceptById', { conceptId: id }, { force }),
    persisted('metGetPricingDataByConceptId', { conceptId: id }, { force }),
    persisted('conceptRetrieveForMedia', { conceptId: id }, { force })
  ]);
  const payloads = requests.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!payloads.length) throw requests.find(result => result.status === 'rejected')?.reason || new Error('PlayStation concept failed');
  const normalized = normalizePsPayload(id, { payloads }, BASE, {
    preferBase: !cleanText(preferredTitle),
    preferredTitle
  });

  if (!normalized.price) {
    const pricedProduct = await pricedConceptProduct({ payloads }, cleanText(preferredTitle) || normalized.title, { force });
    if (pricedProduct?.price) {
      normalized.price = { ...pricedProduct.price };
      normalized.rawHints = {
        ...(normalized.rawHints || {}),
        priceProductId: pricedProduct.providerId || null,
        priceOfferTitle: pricedProduct.title || '',
        priceFallback: 'concept-product'
      };
    }
  }

  normalized.storeUrl = `https://store.playstation.com/${config.psLocale}/concept/${id}`;
  return applyPsPlusMembership(normalized, { force });
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

function catalogEntries(payload) {
  const entries = [];
  const seen = new Set();
  walk(payload, node => {
    if (!node || Array.isArray(node) || typeof node !== 'object') return;
    const id = cleanText(node.productId || node.conceptId || node.id || '');
    const title = cleanText(node.name || node.title || node.productName || node.conceptName || '');
    if (!id || !title) return;
    const key = `${id.toUpperCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ id, title });
  });
  return entries;
}

export async function psPlusCatalog({ force = false, size = 1000 } = {}) {
  const payload = await catalog('psPlus', { force, size, offset: 0 });
  return catalogEntries(payload);
}

async function applyPsPlusMembership(item, { force = false } = {}) {
  if (!item?.title) return item;
  try {
    const entries = await psPlusCatalog({ force: false });
    const ids = new Set(entries.map(entry => entry.id.toUpperCase()));
    const candidateIds = [
      item.providerId,
      item.rawHints?.priceProductId
    ].map(value => String(value || '').trim().toUpperCase()).filter(Boolean);
    const exact = candidateIds.some(id => ids.has(id));
    const titleMatch = exact ? null : entries
      .map(entry => ({ entry, score: storefrontTitleScore(item.title, entry.title) }))
      .sort((a, b) => b.score - a.score)[0];
    const matched = exact || Number(titleMatch?.score || 0) >= 0.92;
    if (!matched) return item;
    item.subscriptions = { ...(item.subscriptions || {}), psPlus: true };
    item.rawHints = {
      ...(item.rawHints || {}),
      psPlusSource: 'playstation-monthly-category',
      psPlusCatalogId: exact
        ? candidateIds.find(id => ids.has(id)) || null
        : titleMatch?.entry?.id || null
    };
  } catch {}
  return item;
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
    try { out.push(hit.kind === 'product' ? await product(hit.id, { force }) : await concept(hit.id, { force, preferredTitle: q })); }
    catch { out.push(canonicalGame('playstation', { providerId: hit.id, title: hit.title, storeUrl: hit.url, sourceUrl: url })); }
  }
  cachePut(key, 'playstation', out, config.ttl.search);
  return out.slice(0, limit);
}

export const playstationProvider = {
  name: 'playstation',
  capabilities: ['search', 'product', 'concept', 'catalog', 'psPlus', 'psPlusCatalog', 'price', 'media'],
  search,
  product,
  concept,
  catalog,
  psPlus,
  psPlusCatalog,
  health: async () => {
    const result = await concept('212779', { force: true });
    return { ok: Boolean(result?.title), sample: result?.title || null, locale: config.psLocale };
  },
  hashes: HASHES
};
