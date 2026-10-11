import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';

const STORE_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const APP_DETAILS = 'https://store.steampowered.com/api/appdetails';

let steamRateLimitedUntil = 0;

function isRateLimitError(error) {
  return Number(error?.status) === 429 || /\b429\b/.test(String(error?.message || ''));
}

function rememberSteamRateLimit(error) {
  const requestedDelay = Number(error?.retryAfterMs || 0);
  const cooldownMs = Math.min(15 * 60_000, Math.max(60_000, requestedDelay));
  steamRateLimitedUntil = Math.max(steamRateLimitedUntil, Date.now() + cooldownMs);
}

function steamCooldownError() {
  const seconds = Math.max(1, Math.ceil((steamRateLimitedUntil - Date.now()) / 1000));
  const error = new Error(`Steam rate limit active; retry in ${seconds}s`);
  error.status = 429;
  error.retryAfterMs = seconds * 1000;
  return error;
}

function normalizeSteam(appId, data) {
  if (!data) return null;
  const genres = uniq((data.genres || []).map(item => item?.description));
  const categories = uniq((data.categories || []).map(item => item?.description));
  const screenshots = (data.screenshots || []).map(item => item?.path_full || item?.path_thumbnail).filter(Boolean);
  const trailers = (data.movies || []).map(movie => movie?.mp4?.max || movie?.mp4?.['480'] || movie?.webm?.max).filter(Boolean);
  const releaseDate = data.release_date?.date || null;
  const price = data.price_overview ? {
    currency: data.price_overview.currency || null,
    current: Number(data.price_overview.final || 0) / 100,
    regular: Number(data.price_overview.initial || 0) / 100,
    discountPercent: Number(data.price_overview.discount_percent || 0),
    isFree: false
  } : data.is_free === true ? {
    currency: null,
    current: 0,
    regular: 0,
    discountPercent: 0,
    isFree: true
  } : null;
  return canonicalGame('steam', {
    providerId: appId,
    title: data.name || '',
    description: cleanText(data.detailed_description || data.about_the_game || ''),
    shortDescription: cleanText(data.short_description || ''),
    developers: data.developers || [],
    publishers: data.publishers || [],
    genres,
    categories,
    platforms: Object.entries(data.platforms || {}).filter(([, enabled]) => enabled).map(([name]) => name),
    releaseDate,
    earlyAccess: genres.some(value => /early access/i.test(value)) || categories.some(value => /early access/i.test(value)),
    price,
    media: {
      cover: data.header_image || data.capsule_image || '',
      hero: data.background_raw || data.background || '',
      screenshots,
      trailers
    },
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    sourceUrl: APP_DETAILS,
    rawHints: { type: data.type || '', requiredAge: data.required_age || 0, recommendations: data.recommendations?.total || 0 }
  });
}

export async function appDetails(appId, { force = false, language = 'english' } = {}) {
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) throw new Error('Invalid Steam App ID');
  const key = `steam:app:${id}:cz:${language}`;
  const stale = cacheGet(key, { allowStale: true });
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  if (Date.now() < steamRateLimitedUntil) {
    if (stale) return stale;
    throw steamCooldownError();
  }
  const url = new URL(APP_DETAILS);
  url.searchParams.set('appids', id);
  url.searchParams.set('cc', 'cz');
  url.searchParams.set('l', language);
  try {
    const payload = await fetchJson(url, { attempts: 4 });
    const wrapper = payload?.[id];
    if (!wrapper?.success || !wrapper?.data) throw new Error(`Steam app ${id} not found`);
    return cachePut(key, 'steam', normalizeSteam(id, wrapper.data), config.ttl.product);
  } catch (error) {
    if (isRateLimitError(error)) {
      rememberSteamRateLimit(error);
      if (stale) return stale;
    }
    throw error;
  }
}

export async function search(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `steam:search:${q.toLowerCase()}`;
  const stale = cacheGet(key, { allowStale: true });
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  if (Date.now() < steamRateLimitedUntil) {
    if (stale) return stale.slice(0, limit);
    throw steamCooldownError();
  }
  const url = new URL(STORE_SEARCH);
  url.searchParams.set('term', q);
  url.searchParams.set('cc', 'CZ');
  url.searchParams.set('l', 'english');
  let payload;
  try {
    payload = await fetchJson(url, { attempts: 4 });
  } catch (error) {
    if (isRateLimitError(error)) {
      rememberSteamRateLimit(error);
      if (stale) return stale.slice(0, limit);
    }
    throw error;
  }
  const items = (payload?.items || []).slice(0, Math.min(limit, 12));
  const detailed = [];
  for (const item of items) {
    try { detailed.push(await appDetails(item.id, { force })); }
    catch {
      detailed.push(canonicalGame('steam', {
        providerId: item.id,
        title: item.name || '',
        price: item.price ? { currentText: item.price } : null,
        media: { cover: item.tiny_image || '' },
        storeUrl: `https://store.steampowered.com/app/${item.id}/`,
        sourceUrl: STORE_SEARCH
      }));
    }
  }
  cachePut(key, 'steam', detailed, config.ttl.search);
  return detailed.slice(0, limit);
}

export async function appList({ ifModifiedSince = 0, force = false } = {}) {
  if (!config.steamWebApiKey) throw new Error('STEAM_WEB_API_KEY is not configured');
  const key = `steam:official-app-list:${ifModifiedSince}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL('https://partner.steam-api.com/IStoreService/GetAppList/v1/');
  const input = {
    key: config.steamWebApiKey,
    if_modified_since: Number(ifModifiedSince) || 0,
    include_games: true,
    include_dlc: true,
    include_software: false,
    include_videos: false,
    include_hardware: false
  };
  url.searchParams.set('input_json', JSON.stringify(input));
  const payload = await fetchJson(url);
  return cachePut(key, 'steam', payload, 24 * 60 * 60_000);
}

export const steamProvider = {
  name: 'steam',
  capabilities: ['search', 'product', 'price', 'media', 'trailer', 'optionalOfficialAppList'],
  search,
  product: appDetails,
  appList,
  health: async () => {
    const result = await appDetails('570', { force: true });
    return { ok: Boolean(result?.title), sample: result?.title || null, documentedListAvailable: Boolean(config.steamWebApiKey) };
  }
};
