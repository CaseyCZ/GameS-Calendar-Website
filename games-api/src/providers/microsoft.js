import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';
import { consolidateMicrosoftSearch, microsoftPriceOf } from '../lib/microsoft-pricing.js';

const SIGL_IDS = Object.freeze({
  console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
  pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
  cloud: '29a81209-df6f-41fd-a528-2ae6b91f719c',
  eaPlay: 'b8900d09-a491-44cc-916e-32b5acae621b'
});

const DISPLAY_CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0/products';

function xboxSearchUrl(query = '') {
  return `https://www.xbox.com/${config.language}/Search/Results?q=${encodeURIComponent(String(query || '').trim())}`;
}

function xboxProductSlug(title = '') {
  return String(title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function xboxProductUrl(title = '', productId = '') {
  const id = String(productId || '').trim().toUpperCase();
  const slug = xboxProductSlug(title) || 'game';
  return id
    ? `https://www.xbox.com/${config.language}/games/store/${slug}/${id}`
    : xboxSearchUrl(title);
}

function xboxLinksFromSearch(html = '') {
  const links = new Map();
  const $ = loadHtml(html);
  $('a[href*="/games/store/"]').each((_, node) => {
    const href = $(node).attr('href') || '';
    const match = href.match(/\/games\/store\/[^/?#"']+\/([A-Z0-9]{10,16})(?:[/?#"'&]|$)/i);
    if (!match) return;
    try {
      links.set(match[1].toUpperCase(), new URL(href, 'https://www.xbox.com').href);
    } catch {}
  });
  return links;
}

function xboxPageSignals(html = '') {
  const text = loadHtml(html).text().replace(/\s+/g, ' ').trim();
  const gamePass = /(přichází\s+do|coming\s+to|included\s+with|součástí|available\s+with)\s+(?:xbox\s+)?game\s*pass/i.test(text);
  const comingSoon = /(přichází\s+do|coming\s+to)\s+(?:xbox\s+)?game\s*pass/i.test(text);
  const preorder = /předobjednat|předobjednáv|pre[- ]?order/i.test(text);
  return { gamePass, comingSoon, preorder };
}


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
export function normalizeMicrosoftProduct(product, subscriptionKinds = [], { storeUrl = '' } = {}) {
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
    price: microsoftPriceOf(product),
    media: {
      cover: images.Poster?.[0] || images.BoxArt?.[0] || images.ProductTitle?.[0] || '',
      hero: images.SuperHeroArt?.[0] || images.Hero?.[0] || images.BrandedKeyArt?.[0] || '',
      logo: images.Logo?.[0] || '',
      screenshots: images.Screenshot || [],
      trailers: []
    },
    subscriptions,
    storeUrl: storeUrl || xboxProductUrl(lp.ProductTitle || lp.productTitle || '', product.ProductId || product.productId),
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

async function catalogSearchProducts(query, { force = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const cacheKey = `microsoft:catalog-search:v1:${config.market}:${config.language}:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const url = new URL('https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products');
  url.searchParams.set('query', q);
  url.searchParams.set('market', config.market);
  url.searchParams.set('languages', config.language);
  url.searchParams.set('fieldsTemplate', 'Details');
  url.searchParams.set('platformdependencyname', 'windows.xbox');

  const payload = await fetchJson(url);
  const products = payload?.Products || payload?.products || payload?.Items || payload?.items || [];
  return cachePut(cacheKey, 'microsoft', Array.isArray(products) ? products : [], config.ttl.search);
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

async function enrichExactXboxProduct(item, { force = false } = {}) {
  if (!item?.providerId) return item;
  const id = String(item.providerId).toUpperCase();
  const pageUrl = xboxProductUrl(item.title, id);
  item.storeUrl = pageUrl;

  try {
    const pageHtml = await fetchText(pageUrl);
    const signals = xboxPageSignals(pageHtml);
    const pageLinks = xboxLinksFromSearch(pageHtml);
    pageLinks.set(id, pageUrl);

    const relatedIds = [...pageLinks.keys()]
      .filter(productId => productId !== id)
      .slice(0, 30);

    let related = [];
    if (relatedIds.length) {
      const products = await displayProducts(relatedIds, { force });
      const productIds = products
        .map(product => String(product?.ProductId || product?.productId || ''))
        .filter(Boolean);
      const membership = await subscriptionKindsForIds(productIds, { force });
      related = products.map(product => {
        const relatedId = String(product?.ProductId || product?.productId || '').toUpperCase();
        return normalizeMicrosoftProduct(product, membership.get(relatedId) || [], {
          storeUrl: pageLinks.get(relatedId) || xboxProductUrl(localProps(product).ProductTitle || '', relatedId)
        });
      }).filter(Boolean);
    }

    const exactTitle = item.title;
    const consolidated = consolidateMicrosoftSearch(item.title, [item, ...related]);
    const enriched = consolidated.find(candidate => String(candidate?.providerId || '').toUpperCase() === id)
      || consolidated[0]
      || item;
    const priceProductId = String(enriched.providerId || '').toUpperCase();
    const priceOfferTitle = enriched.price?.offerTitle || enriched.title || '';

    enriched.providerId = id;
    enriched.title = exactTitle || enriched.title;
    enriched.storeUrl = pageUrl;
    enriched.subscriptions = { ...(enriched.subscriptions || {}) };
    if (signals.gamePass) enriched.subscriptions.gamePass = true;
    enriched.rawHints = {
      ...(enriched.rawHints || {}),
      xboxCanonicalProductId: id,
      xboxPriceProductId: priceProductId || id,
      xboxPriceOfferTitle: priceOfferTitle,
      xboxPageVerified: true,
      xboxGamePassPage: signals.gamePass,
      xboxGamePassComingSoon: signals.comingSoon,
      xboxPreorderPage: signals.preorder
    };
    return enriched;
  } catch {
    return item;
  }
}

export async function product(productId, { force = false, includeSubscriptions = true } = {}) {
  const id = String(productId).toUpperCase();
  const products = await displayProducts([id], { force });
  const membership = includeSubscriptions ? await subscriptionKindsForIds([id], { force }) : new Map();
  const normalized = normalizeMicrosoftProduct(products[0], membership.get(id) || [], {
    storeUrl: products[0] ? xboxProductUrl(localProps(products[0]).ProductTitle || '', id) : ''
  });
  return normalized ? enrichExactXboxProduct(normalized, { force }) : null;
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
  const key = `microsoft:search:v4:${config.market}:${config.language}:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }

  let products = await catalogSearchProducts(q, { force });
  let xboxLinks = new Map();

  if (!products.length) {
    const html = await fetchText(xboxSearchUrl(q));
    xboxLinks = xboxLinksFromSearch(html);
    const ids = new Set(xboxLinks.keys());
    const regex = /\/games\/store\/[^"'<>\s]+\/([A-Z0-9]{10,16})(?=[\/?#"'<>\s]|$)/gi;
    for (const match of html.matchAll(regex)) ids.add(match[1].toUpperCase());
    products = await displayProducts([...ids].slice(0, 20), { force });
  }

  const productIds = products
    .map(item => String(item?.ProductId || item?.productId || '').toUpperCase())
    .filter(Boolean);
  const membership = await subscriptionKindsForIds(productIds, { force });
  let normalized = products.map(item => {
    const id = String(item?.ProductId || item?.productId || '').toUpperCase();
    const title = localProps(item).ProductTitle || localProps(item).productTitle || '';
    return normalizeMicrosoftProduct(item, membership.get(id) || [], {
      storeUrl: xboxLinks.get(id) || xboxProductUrl(title, id)
    });
  }).filter(Boolean);

  let consolidated = consolidateMicrosoftSearch(q, normalized);
  if (!consolidated.length) {
    cachePut(key, 'microsoft', [], config.ttl.search);
    return [];
  }

  let primary = consolidated[0];
  const primaryUrl = primary?.storeUrl && /xbox\.com\/.*\/games\/store\//i.test(primary.storeUrl)
    ? primary.storeUrl
    : '';

  if (primaryUrl) {
    try {
      const pageHtml = await fetchText(primaryUrl);
      const pageLinks = xboxLinksFromSearch(pageHtml);
      const knownIds = new Set(productIds);
      const relatedIds = [...pageLinks.keys()].filter(id => !knownIds.has(id)).slice(0, 30);
      if (relatedIds.length) {
        const relatedProducts = await displayProducts(relatedIds, { force });
        const relatedProductIds = relatedProducts
          .map(item => String(item?.ProductId || item?.productId || '').toUpperCase())
          .filter(Boolean);
        const relatedMembership = await subscriptionKindsForIds(relatedProductIds, { force });
        const relatedNormalized = relatedProducts.map(item => {
          const id = String(item?.ProductId || item?.productId || '').toUpperCase();
          const title = localProps(item).ProductTitle || localProps(item).productTitle || '';
          return normalizeMicrosoftProduct(item, relatedMembership.get(id) || [], {
            storeUrl: pageLinks.get(id) || xboxProductUrl(title, id)
          });
        }).filter(Boolean);
        normalized = [...normalized, ...relatedNormalized];
        consolidated = consolidateMicrosoftSearch(q, normalized);
        primary = consolidated[0] || primary;
      }

      const signals = xboxPageSignals(pageHtml);
      if (primary) {
        primary.subscriptions = { ...(primary.subscriptions || {}) };
        if (signals.gamePass) primary.subscriptions.gamePass = true;
        primary.rawHints = {
          ...(primary.rawHints || {}),
          xboxPageVerified: true,
          xboxGamePassPage: signals.gamePass,
          xboxGamePassComingSoon: signals.comingSoon,
          xboxPreorderPage: signals.preorder
        };
      }
    } catch {}
  }

  cachePut(key, 'microsoft', consolidated, config.ttl.search);
  return consolidated.slice(0, limit);
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
