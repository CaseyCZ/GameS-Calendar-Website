import { load as loadHtml } from 'cheerio';
import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { canonicalGame, cleanText, slugify, titleScore, uniq } from '../lib/normalize.js';

const SITE = 'https://www.nintendo.com';
const ESHOP = 'https://ec.nintendo.com';
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const VALID_LISTS = new Set(['sales', 'new', 'ranking']);

function textAfterHeading($, label) {
  let found = '';
  const wanted = label.toLowerCase();
  $('h2,h3,h4,dt,strong').each((_, node) => {
    if (found) return;
    const text = cleanText($(node).text());
    if (!text || !text.toLowerCase().startsWith(wanted)) return;
    const next = $(node).next();
    found = cleanText(next.text());
    if (!found) {
      const parent = cleanText($(node).parent().text());
      found = parent.slice(text.length).trim();
    }
  });
  return found;
}

function jsonLd($) {
  const values = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    try {
      const parsed = JSON.parse($(node).text());
      if (Array.isArray(parsed)) values.push(...parsed);
      else if (parsed?.['@graph']) values.push(...parsed['@graph']);
      else values.push(parsed);
    } catch {}
  });
  return values;
}

function nintendoTitleId(html = '', url = '') {
  const direct = String(url).match(/\/titles\/(7\d{13})(?:[/?#]|$)/)?.[1];
  if (direct) return direct;
  const matches = String(html).match(/\b7\d{13}\b/g) || [];
  return matches.find(value => /^7001/.test(value)) || matches[0] || '';
}

function stringValues(value) {
  if (!value) return [];
  if (!Array.isArray(value)) value = [value];
  return value.map(item => {
    if (typeof item === 'string') return cleanText(item);
    return cleanText(item?.name || item?.label || item?.title || item?.formal_name || '');
  }).filter(Boolean);
}

function priceObject(entry) {
  if (!entry) return null;
  const regular = entry.regular_price || entry.regularPrice;
  const discount = entry.discount_price || entry.discountPrice;
  const active = discount?.amount != null ? discount : regular;
  if (!active) return null;
  return {
    currency: active.currency || regular?.currency || null,
    current: Number(active.raw_value ?? active.amount ?? 0) || null,
    regular: Number(regular?.raw_value ?? regular?.amount ?? 0) || null,
    currentText: active.amount || null,
    regularText: regular?.amount || null,
    saleStart: discount?.start_datetime || null,
    saleEnd: discount?.end_datetime || null,
    salesStatus: entry.sales_status || null
  };
}

function screenshotUrls(content) {
  const out = [];
  for (const screenshot of content?.screenshots || []) {
    for (const image of screenshot?.images || []) {
      if (image?.url) out.push(image.url);
    }
  }
  return uniq(out);
}

function normalizeEshopContent(content) {
  if (!content) return null;
  const id = String(content.id || content.title_id || '');
  const categories = uniq([
    ...stringValues(content.categories),
    ...stringValues(content.tags)
  ]);
  const screenshots = screenshotUrls(content);
  const rating = content?.rating_info?.rating;
  const publisher = cleanText(content.publisher?.name || content.publisher || '');
  const developer = cleanText(content.developer?.name || content.developer || '');
  const description = cleanText(content.description || content.long_description || content.disclaimer || '');
  const supportedLanguages = stringValues(content.language_availability || content.languages);
  const platformText = cleanText(content.platform || content.platform_name || '');
  const platforms = platformText ? [platformText] : ['Switch'];
  const targetTitleIds = (content.target_titles || []).map(item => String(item?.id || item)).filter(Boolean);

  return canonicalGame('nintendo', {
    providerId: id,
    title: cleanText(content.formal_name || content.title?.en || content.title?.name || content.title || ''),
    description,
    developers: developer ? [developer] : [],
    publishers: publisher ? [publisher] : [],
    genres: categories,
    categories,
    platforms,
    releaseDate: content.release_date_on_eshop || content.release_date || null,
    media: {
      cover: content.cover_url || content.hero_banner_url || screenshots[0] || '',
      hero: content.hero_banner_url || content.cover_url || '',
      screenshots
    },
    storeUrl: id ? `${ESHOP}/${config.nintendoCountry}/${config.nintendoLanguage}/titles/${id}` : '',
    sourceUrl: `${ESHOP}/api/${config.nintendoCountry}/${config.nintendoLanguage}/contents`,
    rawHints: {
      contentType: content.content_type || null,
      publicStatus: content.public_status || null,
      isNew: Boolean(content.is_new),
      rating: rating ? { name: rating.name || null, age: rating.age ?? null } : null,
      supportedLanguages,
      targetTitleIds,
      playersFrom: content.players_from ?? null,
      playersTo: content.players_to ?? null,
      totalRomSize: content.total_rom_size ?? null,
      extraction: 'official-eshop-contents'
    }
  });
}

export async function price(titleIds, { force = false } = {}) {
  const ids = uniq((Array.isArray(titleIds) ? titleIds : [titleIds]).map(String).filter(id => /^7\d{13}$/.test(id))).slice(0, 50);
  if (!ids.length) return { country: config.nintendoCountry, prices: [] };
  const key = `nintendo:price:${config.nintendoCountry}:${config.nintendoLanguage}:${ids.join(',')}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL(PRICE_API);
  url.searchParams.set('country', config.nintendoCountry);
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('lang', config.nintendoLanguage);
  const payload = await fetchJson(url);
  return cachePut(key, 'nintendo', payload, 30 * 60_000);
}

export async function contents(titleIds, { force = false } = {}) {
  const ids = uniq((Array.isArray(titleIds) ? titleIds : [titleIds]).map(String).filter(id => /^7\d{13}$/.test(id))).slice(0, 20);
  if (!ids.length) return [];
  const key = `nintendo:contents:${config.nintendoCountry}:${config.nintendoLanguage}:${ids.join(',')}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL(`${ESHOP}/api/${config.nintendoCountry}/${config.nintendoLanguage}/contents`);
  for (const id of ids) url.searchParams.append('id', id);
  const payload = await fetchJson(url);
  const items = Array.isArray(payload?.contents) ? payload.contents : [];
  return cachePut(key, 'nintendo', items, config.ttl.nintendo);
}

export async function eshopList(kind = 'sales', { force = false, count = 30, offset = 0 } = {}) {
  const list = VALID_LISTS.has(kind) ? kind : 'sales';
  const safeCount = Math.max(1, Math.min(100, Number(count) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const key = `nintendo:eshop:${config.nintendoCountry}:${config.nintendoLanguage}:${list}:${safeCount}:${safeOffset}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL(`${ESHOP}/api/${config.nintendoCountry}/${config.nintendoLanguage}/search/${list}`);
  url.searchParams.set('count', String(safeCount));
  url.searchParams.set('offset', String(safeOffset));
  const payload = await fetchJson(url);
  return cachePut(key, 'nintendo', payload, 60 * 60_000);
}

export function parseNintendoProduct(html, url) {
  const $ = loadHtml(html);
  const ld = jsonLd($);
  const productLd = ld.find(item => /Product|VideoGame/i.test(String(item?.['@type'] || ''))) || {};
  const title = cleanText($('h1').first().text()) || cleanText(productLd.name || $('meta[property="og:title"]').attr('content') || '');
  const metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  const paragraphs = $('main p').map((_, node) => cleanText($(node).text())).get().filter(text => text.length > 70);
  const description = cleanText(productLd.description || metaDescription || paragraphs[0] || '');
  const publisher = textAfterHeading($, 'Publisher');
  const developer = textAfterHeading($, 'Developer');
  const system = textAfterHeading($, 'System') || textAfterHeading($, 'Supported Platforms');
  const releaseDate = textAfterHeading($, 'Release date');
  const languages = textAfterHeading($, 'Supported languages');
  const genreText = textAfterHeading($, 'Genre');
  const titleId = nintendoTitleId(html, url);
  const tags = [];
  $('a[href*="/store/games/"],a[href*="/games/"]').each((_, node) => {
    const text = cleanText($(node).text());
    if (text && text.length < 45) tags.push(text);
  });
  if (genreText) tags.push(...genreText.split(/[\/,]/).map(v => cleanText(v)));
  const images = uniq($('img').map((_, node) => $(node).attr('src') || $(node).attr('data-src')).get().filter(Boolean).map(src => {
    try { return new URL(src, SITE).href; } catch { return ''; }
  }).filter(src => /assets\.nintendo\.com|nintendo-europe\.com|nintendo\.net/i.test(src)));
  const ogImage = $('meta[property="og:image"]').attr('content') || '';
  const platform = /switch\s*2/i.test(`${system} ${url}`) ? 'Switch 2' : 'Switch';
  return canonicalGame('nintendo', {
    providerId: titleId || new URL(url).pathname.split('/').filter(Boolean).at(-1),
    title,
    description,
    developers: developer ? [developer] : [],
    publishers: publisher ? [publisher] : [],
    genres: uniq(tags.slice(0, 12)),
    categories: uniq(tags),
    platforms: system ? uniq(system.split(/[,/]/).map(v => cleanText(v))) : [platform],
    releaseDate,
    media: { cover: ogImage || images[0] || '', hero: images[1] || '', screenshots: images.slice(1, 18) },
    storeUrl: url,
    sourceUrl: url,
    rawHints: { supportedLanguages: languages, titleId: titleId || null, extraction: 'official-html' }
  });
}

export async function productByUrl(url, { force = false } = {}) {
  const parsed = new URL(url);
  if (!/(^|\.)nintendo\.com$/i.test(parsed.hostname)) throw new Error('Nintendo provider only accepts official nintendo.com URLs');
  const key = `nintendo:url:${parsed.href}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const html = await fetchText(parsed.href);
  const result = parseNintendoProduct(html, parsed.href);
  if (!result.title) throw new Error('Nintendo product page could not be parsed');
  const titleId = result.rawHints?.titleId;
  if (titleId) {
    try {
      const official = (await contents(titleId, { force }))[0];
      const normalized = normalizeEshopContent(official);
      if (normalized) {
        result.providerId = normalized.providerId || result.providerId;
        result.releaseDate ||= normalized.releaseDate;
        result.genres = uniq([...(result.genres || []), ...(normalized.genres || [])]);
        result.categories = uniq([...(result.categories || []), ...(normalized.categories || [])]);
        result.media.screenshots = uniq([...(result.media?.screenshots || []), ...(normalized.media?.screenshots || [])]);
        result.rawHints = { ...(result.rawHints || {}), ...(normalized.rawHints || {}), extraction: 'official-html+eshop-contents' };
      }
    } catch {}
    try {
      const pricing = await price(titleId, { force });
      const hit = (pricing?.prices || []).find(item => String(item?.title_id || item?.titleId) === String(titleId));
      result.price = priceObject(hit);
    } catch {}
  }
  return cachePut(key, 'nintendo', result, config.ttl.nintendo);
}

export async function productById(titleId, { force = false } = {}) {
  const id = String(titleId || '').trim();
  if (!/^7\d{13}$/.test(id)) throw new Error('Invalid Nintendo title ID');
  const key = `nintendo:id:${config.nintendoCountry}:${config.nintendoLanguage}:${id}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const item = (await contents(id, { force }))[0];
  if (!item) throw new Error(`Nintendo title ${id} not found in official contents API`);
  const result = normalizeEshopContent(item);
  if (!result?.title) throw new Error(`Nintendo title ${id} returned no title`);
  const pricing = await price(id, { force }).catch(() => null);
  const hit = (pricing?.prices || []).find(entry => String(entry?.title_id || entry?.titleId) === id);
  if (hit) result.price = priceObject(hit);
  result.providerId = id;
  result.rawHints = { ...(result.rawHints || {}), titleId: id };
  return cachePut(key, 'nintendo', result, config.ttl.nintendo);
}

async function candidateUrls(query) {
  const slug = slugify(query);
  if (!slug) return [];
  return [
    `${SITE}/${config.nintendoRegion}/store/products/${slug}-switch/`,
    `${SITE}/${config.nintendoRegion}/store/products/${slug}-switch-2/`,
    `${SITE}/${config.nintendoRegion}/store/products/${slug}-nintendo-switch-2-edition-switch-2/`
  ];
}

async function catalogCandidates(q, { force = false } = {}) {
  const candidates = [];
  for (const kind of ['new', 'sales', 'ranking']) {
    try {
      const payload = await eshopList(kind, { force, count: 100 });
      for (const item of payload?.contents || []) {
        const title = item?.formal_name || item?.formalName || '';
        const id = String(item?.id || item?.title_id || '');
        if (titleScore(q, title) >= 0.42 && id) candidates.push({ id, title, kind });
      }
    } catch {}
  }
  return [...new Map(candidates.map(item => [item.id, item])).values()]
    .sort((a, b) => titleScore(q, b.title) - titleScore(q, a.title));
}

export async function search(query, { force = false, limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `nintendo:search:${config.nintendoCountry}:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  const results = [];

  for (const candidate of (await catalogCandidates(q, { force })).slice(0, limit)) {
    try {
      const item = await productById(candidate.id, { force });
      if (titleScore(q, item.title) >= 0.42) results.push(item);
    } catch {}
  }

  if (results.length < limit) {
    const searchUrl = `${SITE}/${config.nintendoRegion}/search/?q=${encodeURIComponent(q)}`;
    try {
      const html = await fetchText(searchUrl, { attempts: 1 });
      const $ = loadHtml(html);
      const urls = uniq($('a[href*="/store/products/"]').map((_, node) => {
        const href = $(node).attr('href');
        if (!href) return '';
        try { return new URL(href, SITE).href; } catch { return ''; }
      }).get()).slice(0, 12);
      for (const url of urls) {
        try {
          const item = await productByUrl(url, { force });
          if (titleScore(q, item.title) >= 0.38) results.push(item);
        } catch {}
        if (results.length >= limit) break;
      }
    } catch {}
  }

  if (!results.length) {
    for (const url of await candidateUrls(q)) {
      try {
        const item = await productByUrl(url, { force });
        if (titleScore(q, item.title) >= 0.55) results.push(item);
      } catch {}
      if (results.length >= limit) break;
    }
  }

  const unique = [...new Map(results.map(item => [`${item.providerId}:${item.storeUrl}`, item])).values()]
    .sort((a, b) => titleScore(q, b.title) - titleScore(q, a.title));
  cachePut(key, 'nintendo', unique, config.ttl.search);
  return unique.slice(0, limit);
}

export const nintendoProvider = {
  name: 'nintendo',
  capabilities: ['searchBestEffort', 'productPage', 'titleId', 'contents', 'price', 'eshopLists', 'media', 'releaseDate'],
  search,
  productByUrl,
  productById,
  contents,
  price,
  eshopList,
  health: async () => {
    const sampleId = '70010000063715';
    const sample = await productById(sampleId, { force: true });
    const list = await eshopList('new', { force: true, count: 5 });
    return {
      ok: Boolean(sample?.title && sample?.releaseDate && Array.isArray(list?.contents)),
      sample: sample?.title || null,
      releaseDate: sample?.releaseDate || null,
      priced: Boolean(sample?.price),
      listCount: list?.contents?.length || 0,
      country: config.nintendoCountry
    };
  }
};
