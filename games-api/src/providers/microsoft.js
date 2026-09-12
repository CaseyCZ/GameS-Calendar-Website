import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';

const SIGL_IDS = Object.freeze({
  console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
  pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
  cloud: '29a81209-df6f-41fd-a528-2ae6b91f719c',
  eaPlay: 'b8900d09-a491-44cc-916e-32b5acae621b'
});

const DISPLAY_CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0/products';

function localProps(product) {
  return product?.LocalizedProperties?.[0] || product?.localizedProperties?.[0] || {};
}
function properties(product) {
  return product?.Properties || product?.properties || {};
}
function marketProps(product) {
  return product?.MarketProperties?.[0] || product?.marketProperties?.[0] || {};
}
function strArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === 'string' ? item : item?.Name || item?.name || item?.DisplayName || item?.displayName).filter(Boolean);
}
function imageMap(product) {
  const images = localProps(product)?.Images || [];
  const grouped = {};
  for (const image of images) {
    const purpose = image?.ImagePurpose || image?.imagePurpose || 'Other';
    let uri = image?.Uri || image?.uri || '';
    if (uri.startsWith('//')) uri = `https:${uri}`;
    if (!uri) continue;
    (grouped[purpose] ||= []).push(uri);
  }
  return grouped;
}
function priceOf(product) {
  const availability = product?.DisplaySkuAvailabilities?.[0]?.Availabilities?.[0];
  const price = availability?.OrderManagementData?.Price;
  if (!price) return null;
  return {
    currency: price.CurrencyCode || null,
    current: Number(price.ListPrice ?? price.MSRP ?? 0),
    regular: Number(price.MSRP ?? price.ListPrice ?? 0),
    wholesale: Number(price.WholesalePrice ?? 0) || null,
    saleStart: availability?.Conditions?.StartDate || null,
    saleEnd: availability?.Conditions?.EndDate || null
  };
}

export function normalizeMicrosoftProduct(product, subscriptionKinds = []) {
  if (!product) return null;
  const lp = localProps(product);
  const p = properties(product);
  const mp = marketProps(product);
  const images = imageMap(product);
  const allowed = strArray(p.AllowedPlatforms || p.allowedPlatforms);
  const gen = strArray(p.XboxConsoleGenCompatible || p.xboxConsoleGenCompatible);
  const platforms = [];
  if (allowed.some(v => /Windows\.Desktop/i.test(v))) platforms.push('PC');
  if (allowed.some(v => /Windows\.Xbox/i.test(v)) || gen.length) platforms.push('Xbox');
  if (gen.some(v => /Gen9/i.test(v))) platforms.push('Xbox Series');
  if (gen.some(v => /Gen8/i.test(v))) platforms.push('Xbox One');
  const categories = uniq([
    ...strArray(p.Categories || p.categories),
    ...strArray(lp.Categories || lp.categories),
    typeof p.Category === 'string' ? p.Category : ''
  ]);
  const subscriptions = {
    gamePass: subscriptionKinds.some(v => ['console', 'pc', 'cloud'].includes(v)),
    gamePassConsole: subscriptionKinds.includes('console'),
    gamePassPc: subscriptionKinds.includes('pc'),
    cloudGaming: subscriptionKinds.includes('cloud'),
    eaPlay: subscriptionKinds.includes('eaPlay')
  };
  return canonicalGame('microsoft', {
    providerId: product.ProductId || product.productId,
    title: lp.ProductTitle || lp.productTitle || '',
    description: cleanText(lp.ProductDescription || lp.productDescription || ''),
    shortDescription: cleanText(lp.ShortDescription || lp.shortDescription || ''),
    developers: uniq([lp.DeveloperName || lp.developerName]),
    publishers: uniq([lp.PublisherName || lp.publisherName]),
    genres: categories,
    categories,
    platforms,
    releaseDate: mp.OriginalReleaseDate || mp.originalReleaseDate,
    rating: mp?.UsageData?.find?.(entry => entry.AggregateTimeSpan === 'AllTime')?.AverageRating || 0,
    price: priceOf(product),
    media: {
      cover: images.Poster?.[0] || images.BoxArt?.[0] || images.ProductTitle?.[0] || '',
      hero: images.SuperHeroArt?.[0] || images.Hero?.[0] || images.BrandedKeyArt?.[0] || '',
      logo: images.Logo?.[0] || '',
      screenshots: images.Screenshot || [],
      trailers: []
    },
    subscriptions,
    storeUrl: product.ProductId ? `https://apps.microsoft.com/detail/${product.ProductId}?hl=${encodeURIComponent(config.language)}&gl=${encodeURIComponent(config.market)}` : '',
    sourceUrl: DISPLAY_CATALOG,
    rawHints: {
      xboxTitleId: p.XboxTitleId || null,
      packageIdentityName: p.PackageIdentityName || null,
      imagePurposes: Object.keys(images)
    }
  });
}

export async function gamePassIds(kind, { force = false } = {}) {
  if (!SIGL_IDS[kind]) throw new Error(`Unknown Game Pass list: ${kind}`);
  const key = `microsoft:gamepass:${kind}:${config.market}:${config.language}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL('https://catalog.gamepass.com/sigls/v2');
  url.searchParams.set('id', SIGL_IDS[kind]);
  url.searchParams.set('language', config.language);
  url.searchParams.set('market', config.market);
  const payload = await fetchJson(url);
  if (!Array.isArray(payload)) throw new Error('Game Pass SIGL response is not an array');
  const ids = uniq(payload.map(item => item?.id || item?.Id).filter(Boolean).map(String));
  if (!ids.length) throw new Error(`Game Pass ${kind} returned zero IDs`);
  return cachePut(key, 'microsoft', { kind, ids, count: ids.length, sourceUrl: url.href }, config.ttl.gamePass);
}

export async function displayProducts(ids, { force = false } = {}) {
  const unique = uniq((ids || []).map(String)).slice(0, 200);
  if (!unique.length) return [];
  const cacheKey = `microsoft:products:${config.market}:${config.language}:${unique.join(',')}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }
  const url = new URL(DISPLAY_CATALOG);
  url.searchParams.set('bigIds', unique.join(','));
  url.searchParams.set('market', config.market);
  url.searchParams.set('languages', config.language);
  url.searchParams.set('fieldsTemplate', 'Details');
  const payload = await fetchJson(url);
  const products = payload?.Products || payload?.products || [];
  return cachePut(cacheKey, 'microsoft', products, config.ttl.product);
}

export async function subscriptionKindsForIds(ids, { force = false } = {}) {
  const wanted = new Set((ids || []).map(String));
  const out = new Map([...wanted].map(id => [id, []]));
  if (!wanted.size) return out;
  const kinds = Object.keys(SIGL_IDS);
  const lists = await Promise.allSettled(kinds.map(kind => gamePassIds(kind, { force })));
  lists.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const kind = kinds[index];
    const set = new Set(result.value.ids || []);
    for (const id of wanted) if (set.has(id)) out.get(id).push(kind);
  });
  return out;
}

export async function product(productId, { force = false, includeSubscriptions = true } = {}) {
  const id = String(productId);
  const products = await displayProducts([id], { force });
  const membership = includeSubscriptions ? await subscriptionKindsForIds([id], { force }) : new Map();
  return normalizeMicrosoftProduct(products[0], membership.get(id) || []);
}

export async function gamePassCatalog(kind, { force = false, limit = 1000 } = {}) {
  const list = await gamePassIds(kind, { force });
  const ids = list.ids.slice(0, Math.max(1, Math.min(Number(limit) || 1000, 5000)));
  const products = [];
  for (let i = 0; i < ids.length; i += 20) {
    products.push(...await displayProducts(ids.slice(i, i + 20), { force }));
  }
  return products.map(item => normalizeMicrosoftProduct(item, [kind])).filter(Boolean);
}

export async function search(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `microsoft:search:${config.language}:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  const locale = config.language;
  const url = `https://www.xbox.com/${locale}/Search/Results?q=${encodeURIComponent(q)}`;
  const html = await fetchText(url);
  const ids = new Set();
  const regex = /\/games\/store\/[^"'<>\s]+\/([A-Z0-9]{10,16})(?=[\/?#"'<>\s]|$)/gi;
  for (const match of html.matchAll(regex)) ids.add(match[1]);
  if (!ids.size) {
    const $ = loadHtml(html);
    $('a[href*="/games/store/"]').each((_, node) => {
      const href = $(node).attr('href') || '';
      const m = href.match(/\/([A-Z0-9]{10,16})(?:[/?#]|$)/i);
      if (m) ids.add(m[1]);
    });
  }
  const products = await displayProducts([...ids].slice(0, 20), { force });
  const productIds = products.map(item => String(item?.ProductId || item?.productId || '')).filter(Boolean);
  const membership = await subscriptionKindsForIds(productIds, { force });
  const normalized = products.map(item => {
    const id = String(item?.ProductId || item?.productId || '');
    return normalizeMicrosoftProduct(item, membership.get(id) || []);
  }).filter(Boolean);
  cachePut(key, 'microsoft', normalized, config.ttl.search);
  return normalized.slice(0, limit);
}

export const microsoftProvider = {
  name: 'microsoft',
  capabilities: ['search', 'product', 'gamePass', 'cloudGaming', 'price', 'media'],
  search,
  product,
  gamePassIds,
  gamePassCatalog,
  subscriptionKindsForIds,
  health: async () => {
    const console = await gamePassIds('console', { force: true });
    const pc = await gamePassIds('pc', { force: true });
    const cloud = await gamePassIds('cloud', { force: true });
    return { ok: console.count > 0 && pc.count > 0 && cloud.count > 0, console: console.count, pc: pc.count, cloud: cloud.count };
  }
};

export { SIGL_IDS };
