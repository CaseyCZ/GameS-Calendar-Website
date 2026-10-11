import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';

const STORE_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const APP_DETAILS = 'https://store.steampowered.com/api/appdetails';
const STEAM_REQUEST_GAP_MS = 250;
const STEAM_NOT_FOUND_TTL_MS = 6 * 60 * 60_000;
const STEAM_ALLOW_FORCE_REFRESH = process.env.STEAM_ALLOW_FORCE_REFRESH === '1';

let steamRateLimitedUntil = 0;
let steamRequestQueue = Promise.resolve();
let steamLastRequestAt = 0;
const steamNotFoundUntil = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function rememberSteamNotFound(appId) {
  steamNotFoundUntil.set(String(appId), Date.now() + STEAM_NOT_FOUND_TTL_MS);
  while (steamNotFoundUntil.size > 2048) {
    steamNotFoundUntil.delete(steamNotFoundUntil.keys().next().value);
  }
}

function isSteamNotFoundCached(appId) {
  const key = String(appId);
  const until = Number(steamNotFoundUntil.get(key) || 0);
  if (!until) return false;
  if (Date.now() >= until) {
    steamNotFoundUntil.delete(key);
    return false;
  }
  return true;
}

async function runSteamRequest(task) {
  const run = async () => {
    if (Date.now() < steamRateLimitedUntil) throw steamCooldownError();

    const waitMs = Math.max(0, STEAM_REQUEST_GAP_MS - (Date.now() - steamLastRequestAt));
    if (waitMs) await sleep(waitMs);

    try {
      return await task();
    } catch (error) {
      if (isRateLimitError(error)) rememberSteamRateLimit(error);
      throw error;
    } finally {
      steamLastRequestAt = Date.now();
    }
  };

  const pending = steamRequestQueue.then(run, run);
  steamRequestQueue = pending.catch(() => null);
  return pending;
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
  force = Boolean(force && STEAM_ALLOW_FORCE_REFRESH);
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) throw new Error('Invalid Steam App ID');
  const key = `steam:app:${id}:cz:${language}`;
  const stale = cacheGet(key, { allowStale: true });

  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
    if (isSteamNotFoundCached(id)) return null;
  }

  if (Date.now() < steamRateLimitedUntil) {
    if (stale) return stale;
    return null;
  }

  const url = new URL(APP_DETAILS);
  url.searchParams.set('appids', id);
  url.searchParams.set('cc', 'cz');
  url.searchParams.set('l', language);

  try {
    const payload = await runSteamRequest(() => fetchJson(url, { attempts: 1 }));
    const wrapper = payload?.[id];
    if (!wrapper?.success || !wrapper?.data) {
      rememberSteamNotFound(id);
      console.log(`[Steam] App ${id} nebyla nalezena; ukládám negativní cache.`);
      return null;
    }
    return cachePut(key, 'steam', normalizeSteam(id, wrapper.data), config.ttl.product);
  } catch (error) {
    if (isRateLimitError(error)) {
      if (stale) return stale;
      console.log(`[Steam] Rate limit aktivní; App ${id} nyní přeskočena.`);
      return null;
    }
    throw error;
  }
}

export async function search(query, { force = false, limit = 8 } = {}) {
  force = Boolean(force && STEAM_ALLOW_FORCE_REFRESH);
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `steam:search:${q.toLowerCase()}`;
  const stale = cacheGet(key, { allowStale: true });
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  if (Date.now() < steamRateLimitedUntil) {
    return stale ? stale.slice(0, limit) : [];
  }

  const url = new URL(STORE_SEARCH);
  url.searchParams.set('term', q);
  url.searchParams.set('cc', 'CZ');
  url.searchParams.set('l', 'english');

  let payload;
  try {
    payload = await runSteamRequest(() => fetchJson(url, { attempts: 1 }));
  } catch (error) {
    if (isRateLimitError(error)) {
      console.log(`[Steam] Rate limit aktivní; hledání „${q}“ nyní přeskočeno.`);
      return stale ? stale.slice(0, limit) : [];
    }
    throw error;
  }

  const items = (payload?.items || []).slice(0, Math.min(limit, 12));
  const detailed = [];
  for (const item of items) {
    const fallback = () => canonicalGame('steam', {
      providerId: item.id,
      title: item.name || '',
      price: item.price ? { currentText: item.price } : null,
      media: { cover: item.tiny_image || '' },
      storeUrl: `https://store.steampowered.com/app/${item.id}/`,
      sourceUrl: STORE_SEARCH
    });

    try {
      const detail = await appDetails(item.id, { force });
      detailed.push(detail || fallback());
    } catch {
      detailed.push(fallback());
    }
  }
  cachePut(key, 'steam', detailed, config.ttl.search);
  return detailed.slice(0, limit);
}

export async function appList({ ifModifiedSince = 0, force = false } = {}) {
  force = Boolean(force && STEAM_ALLOW_FORCE_REFRESH);
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
    const result = await appDetails('570', { force: false });
    return { ok: Boolean(result?.title), sample: result?.title || null, documentedListAvailable: Boolean(config.steamWebApiKey) };
  }
};
