import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, storefrontTitleScore, titleScore, uniq } from '../lib/normalize.js';

const SEARCH_HOST = 'https://searching.nintendo-europe.com';
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const NINTENDO_SITE = 'https://www.nintendo.com';
const ESHOP = 'https://ec.nintendo.com';
const VALID_LISTS = new Set(['sales', 'new', 'ranking']);

const arr = value => value == null ? [] : Array.isArray(value) ? value : [value];
const first = value => Array.isArray(value) ? value[0] : value;

function nsuidFromDoc(doc = {}) {
  return String(arr(doc.nsuid_txt).find(value => /^7\d{13}$/.test(String(value)))
    || arr(doc.related_nsuids_txt).find(value => /^7\d{13}$/.test(String(value)))
    || '').trim();
}

function normalizePlatforms(doc = {}) {
  const named = arr(doc.system_names_txt).map(cleanText).filter(Boolean);
  if (named.length) return uniq(named);
  const codes = arr(doc.playable_on_txt).map(value => String(value).toUpperCase());
  const result = [];
  if (codes.includes('HAC')) result.push('Nintendo Switch');
  if (codes.includes('BEE')) result.push('Nintendo Switch 2');
  return result.length ? result : ['Nintendo Switch'];
}

function normalizeDoc(doc = {}) {
  const nsuid = nsuidFromDoc(doc);
  const categories = uniq([
    ...arr(doc.pretty_game_categories_txt),
    ...arr(doc.game_categories_txt),
    ...arr(doc.game_category)
  ].map(cleanText).filter(Boolean));
  const cover = cleanText(doc.image_url_sq_s || doc.image_url || doc.image_url_tm_s || doc.gift_finder_wishlist_image_url_s || '');
  const hero = cleanText(doc.gift_finder_detail_page_image_url_s || doc.gift_finder_carousel_image_url_s || cover);
  let storeUrl = cleanText(doc.url || doc.gift_finder_detail_page_store_link_s || '');
  if (storeUrl) {
    try { storeUrl = new URL(storeUrl, NINTENDO_SITE).href; } catch {}
  }
  const releaseDate = first(doc.dates_released_dts) || doc.date_from || doc.release_date_on_eshop || null;
  const description = cleanText(doc.excerpt || doc.product_catalog_description_s || doc.gift_finder_description_s || '');
  const publisher = cleanText(doc.publisher || '');
  const developer = cleanText(doc.developer || '');

  return canonicalGame('nintendo', {
    providerId: nsuid || String(doc.fs_id || ''),
    title: cleanText(doc.title || doc.sorting_title || ''),
    description,
    developers: developer ? [developer] : [],
    publishers: publisher ? [publisher] : [],
    genres: categories,
    categories,
    platforms: normalizePlatforms(doc),
    releaseDate,
    media: { cover, hero, screenshots: [] },
    storeUrl,
    sourceUrl: `${SEARCH_HOST}/${config.nintendoLanguage}/select`,
    rawHints: {
      nsuid: nsuid || null,
      fsId: doc.fs_id || null,
      ageRating: doc.pretty_agerating_s || doc.age_rating_value || null,
      ageRatingType: doc.age_rating_type || null,
      supportedLanguages: arr(doc.language_availability),
      playersFrom: doc.players_from ?? null,
      playersTo: doc.players_to ?? null,
      physicalVersion: doc.physical_version_b ?? null,
      productCodes: arr(doc.product_code_txt),
      series: doc.game_series_t || null,
      playableOn: arr(doc.playable_on_txt),
      extraction: 'official-nintendo-europe-search'
    }
  });
}

function priceObject(entry) {
  if (!entry) return null;
  const regular = first(entry.regular_price || entry.regularPrice);
  const discount = first(entry.discount_price || entry.discountPrice);
  const active = discount?.amount != null ? discount : regular;
  if (!active) return null;
  const number = value => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    currency: active.currency || regular?.currency || null,
    current: number(active.raw_value ?? active.amount),
    regular: number(regular?.raw_value ?? regular?.amount),
    currentText: active.amount || null,
    regularText: regular?.amount || null,
    saleStart: discount?.start_datetime || null,
    saleEnd: discount?.end_datetime || null,
    salesStatus: entry.sales_status || null
  };
}

async function solr({ q = '*', fq = 'type:GAME', rows = 20, start = 0, sort = '', force = false } = {}) {
  const language = String(config.nintendoLanguage || 'en').split('-')[0].toLowerCase();
  const url = new URL(`${SEARCH_HOST}/${language}/select`);
  url.searchParams.set('q', q || '*');
  url.searchParams.set('fq', fq || 'type:GAME');
  url.searchParams.set('start', String(Math.max(0, Number(start) || 0)));
  url.searchParams.set('rows', String(Math.max(1, Math.min(200, Number(rows) || 20))));
  url.searchParams.set('wt', 'json');
  if (sort) url.searchParams.set('sort', sort);

  const key = `nintendo:solr:${url.searchParams.toString()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const payload = await fetchJson(url, { attempts: 2, timeoutMs: 10_000 });
  return cachePut(key, 'nintendo', payload, config.ttl.nintendo);
}

export async function price(titleIds, { force = false } = {}) {
  const ids = uniq(arr(titleIds).map(String).filter(id => /^7\d{13}$/.test(id))).slice(0, 50);
  if (!ids.length) return { country: config.nintendoCountry, prices: [] };
  const key = `nintendo:price:${config.nintendoCountry}:${ids.join(',')}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL(PRICE_API);
  url.searchParams.set('country', config.nintendoCountry);
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('lang', String(config.nintendoLanguage || 'en').split('-')[0]);
  const payload = await fetchJson(url, { attempts: 2, timeoutMs: 10_000 });
  return cachePut(key, 'nintendo', payload, 30 * 60_000);
}

export async function contents(titleIds, { force = false } = {}) {
  const ids = uniq(arr(titleIds).map(String).filter(id => /^7\d{13}$/.test(id))).slice(0, 20);
  if (!ids.length) return [];
  const clause = ids.map(id => `nsuid_txt:${id}`).join(' OR ');
  const payload = await solr({ q: '*', fq: `type:GAME AND (${clause})`, rows: Math.max(20, ids.length * 2), force });
  const docs = arr(payload?.response?.docs);
  const byId = new Map();
  for (const doc of docs) {
    const id = nsuidFromDoc(doc);
    if (id) byId.set(id, doc);
  }
  return ids.map(id => byId.get(id)).filter(Boolean);
}

export async function eshopList(kind = 'new', { force = false, count = 30, offset = 0 } = {}) {
  const list = VALID_LISTS.has(kind) ? kind : 'new';
  const safeCount = Math.max(1, Math.min(100, Number(count) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);
  let fq = 'type:GAME';
  let sort = 'date_from desc';
  if (list === 'sales') {
    fq += ' AND price_has_discount_b:true';
    sort = 'price_discount_percentage_f desc, date_from desc';
  } else if (list === 'ranking') {
    sort = 'score desc, date_from desc';
  }
  const payload = await solr({ q: '*', fq, rows: safeCount, start: safeOffset, sort, force });
  const docs = arr(payload?.response?.docs);
  return {
    contents: docs,
    length: docs.length,
    offset: safeOffset,
    total: Number(payload?.response?.numFound || docs.length)
  };
}

export async function productById(titleId, { force = false } = {}) {
  const id = String(titleId || '').trim();
  if (!/^7\d{13}$/.test(id)) throw new Error('Invalid Nintendo title ID');
  const key = `nintendo:id:${config.nintendoCountry}:${id}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const doc = (await contents(id, { force }))[0];
  if (!doc) throw new Error(`Nintendo title ${id} not found in official Europe search API`);
  const result = normalizeDoc(doc);
  result.providerId = id;
  const pricing = await price(id, { force }).catch(() => null);
  const hit = arr(pricing?.prices).find(entry => String(entry?.title_id || entry?.titleId) === id);
  if (hit) result.price = priceObject(hit);
  return cachePut(key, 'nintendo', result, config.ttl.nintendo);
}

export async function productByUrl(url, { force = false } = {}) {
  const parsed = new URL(url);
  if (!/(^|\.)(nintendo\.com|ec\.nintendo\.com)$/i.test(parsed.hostname)) {
    throw new Error('Nintendo provider only accepts official Nintendo URLs');
  }
  const direct = parsed.href.match(/\b(7\d{13})\b/)?.[1];
  if (direct) return productById(direct, { force });

  const html = await fetchText(parsed.href, { attempts: 1, timeoutMs: 10_000 });
  const embedded = html.match(/\b(7\d{13})\b/)?.[1];
  if (embedded) return productById(embedded, { force });

  const $ = loadHtml(html);
  const title = cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || '');
  if (!title) throw new Error('Nintendo page did not expose a title or NSUID');
  const results = await search(title, { force, limit: 3 });
  if (!results.length) throw new Error(`Nintendo title not found for page: ${title}`);
  return results[0];
}

export async function search(query, { force = false, limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `nintendo:search:v2:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  const payload = await solr({ q, fq: 'type:GAME', rows: Math.max(12, limit * 3), sort: 'score desc, date_from desc', force });
  const candidates = arr(payload?.response?.docs)
    .map(normalizeDoc)
    .filter(item => item?.title)
    .map(item => ({
      item,
      score: titleScore(q, item.title),
      storefrontScore: storefrontTitleScore(q, item.title)
    }))
    .filter(entry => entry.score >= 0.28)
    .sort((a, b) => b.storefrontScore - a.storefrontScore || b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);

  await Promise.all(candidates.map(async item => {
    if (!/^7\d{13}$/.test(String(item.providerId))) return;
    const pricing = await price(item.providerId, { force }).catch(() => null);
    const hit = arr(pricing?.prices).find(entry => String(entry?.title_id || entry?.titleId) === String(item.providerId));
    if (hit) item.price = priceObject(hit);
  }));

  cachePut(key, 'nintendo', candidates, config.ttl.search);
  return candidates;
}

export const nintendoProvider = {
  name: 'nintendo',
  capabilities: ['search', 'productPage', 'titleId', 'catalog', 'price', 'media', 'releaseDate'],
  search,
  productByUrl,
  productById,
  contents,
  price,
  eshopList,
  health: async () => {
    // The newest few records can be placeholders/preorders without NSUID. Sample
    // a wider official catalog window and validate one purchasable title instead.
    const list = await eshopList('new', { force: true, count: 100 });
    const firstDoc = list.contents.find(doc => nsuidFromDoc(doc));
    if (!firstDoc) return { ok: false, reason: 'Nintendo Europe search returned no NSUID in first 100 games', listCount: list.contents.length };
    const id = nsuidFromDoc(firstDoc);
    const sample = await productById(id, { force: true });
    return {
      ok: Boolean(sample?.title && list.contents.length),
      sample: sample?.title || null,
      releaseDate: sample?.releaseDate || null,
      priced: Boolean(sample?.price),
      listCount: list.contents.length,
      country: config.nintendoCountry,
      endpoint: `${SEARCH_HOST}/${String(config.nintendoLanguage || 'en').split('-')[0]}/select`
    };
  }
};
