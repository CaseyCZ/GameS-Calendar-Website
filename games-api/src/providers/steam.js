import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, cleanText, uniq } from '../lib/normalize.js';

const STORE_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const APP_DETAILS = 'https://store.steampowered.com/api/appdetails';
const STEAM_SPY = 'https://steamspy.com/api.php';

function normalizeSteam(appId, data) {
  if (!data) return null;
  const genres = uniq((data.genres || []).map(item => item?.description));
  const categories = uniq((data.categories || []).map(item => item?.description));
  const screenshots = (data.screenshots || []).map(item => item?.path_full || item?.path_thumbnail).filter(Boolean);
  const trailers = (data.movies || []).map(movie => movie?.mp4?.max || movie?.mp4?.['480'] || movie?.webm?.max).filter(Boolean);
  const releaseDate = data.release_date?.date || null;
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
    media: {
      cover: data.header_image || data.capsule_image || '',
      hero: data.background_raw || data.background || '',
      screenshots,
      trailers
    },
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    sourceUrl: APP_DETAILS,
    rawHints: { type: data.type || '', requiredAge: data.required_age || 0, recommendations: data.recommendations?.total || 0, source: 'steam-store' }
  });
}

function splitList(value = '') {
  return uniq(String(value || '').split(',').map(item => item.trim()).filter(Boolean));
}

function splitCompanies(value = '') {
  return uniq(String(value || '').split(/\s*;\s*/).map(item => item.trim()).filter(Boolean));
}

function normalizeSteamSpy(appId, data) {
  if (!data || !String(data.name || '').trim()) return null;
  const positive = Number(data.positive || 0);
  const negative = Number(data.negative || 0);
  const ratingCount = positive + negative;
  const rating = ratingCount > 0 ? Math.round((positive / ratingCount) * 1000) / 10 : 0;
  const categories = Object.entries(data.tags || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 20)
    .map(([name]) => name);

  return canonicalGame('steam', {
    providerId: appId,
    title: String(data.name || '').trim(),
    developers: splitCompanies(data.developer),
    publishers: splitCompanies(data.publisher),
    genres: splitList(data.genre),
    categories,
    rating,
    ratingCount,
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    sourceUrl: `${STEAM_SPY}?request=appdetails&appid=${encodeURIComponent(appId)}`,
    rawHints: { source: 'steamspy', positive, negative }
  });
}

async function steamSpyDetails(appId, { force = false } = {}) {
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) throw new Error('Invalid Steam App ID');
  const key = `steam:spy:${id}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const url = new URL(STEAM_SPY);
  url.searchParams.set('request', 'appdetails');
  url.searchParams.set('appid', id);
  const payload = await fetchJson(url);
  const normalized = normalizeSteamSpy(id, payload);
  if (!normalized?.title) throw new Error(`SteamSpy app ${id} not found`);
  return cachePut(key, 'steam', normalized, config.ttl.product);
}

export async function appDetails(appId, { force = false, language = 'english' } = {}) {
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) throw new Error('Invalid Steam App ID');
  const key = `steam:app:${id}:cz:${language}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  try {
    const url = new URL(APP_DETAILS);
    url.searchParams.set('appids', id);
    url.searchParams.set('cc', 'cz');
    url.searchParams.set('l', language);
    const payload = await fetchJson(url);
    const wrapper = payload?.[id];
    if (!wrapper?.success || !wrapper?.data) throw new Error(`Steam app ${id} not found`);
    return cachePut(key, 'steam', normalizeSteam(id, wrapper.data), config.ttl.product);
  } catch (storeError) {
    try {
      const fallback = await steamSpyDetails(id, { force });
      return cachePut(key, 'steam', fallback, config.ttl.product);
    } catch (spyError) {
      throw new Error(`Steam Store failed: ${storeError?.message || storeError}; SteamSpy failed: ${spyError?.message || spyError}`);
    }
  }
}

export async function search(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `steam:search:${q.toLowerCase()}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, limit);
  }
  const url = new URL(STORE_SEARCH);
  url.searchParams.set('term', q);
  url.searchParams.set('cc', 'CZ');
  url.searchParams.set('l', 'english');
  const payload = await fetchJson(url);
  const items = (payload?.items || []).slice(0, Math.min(limit, 12));
  const detailed = [];
  for (const item of items) {
    try { detailed.push(await appDetails(item.id, { force })); }
    catch {
      detailed.push(canonicalGame('steam', {
        providerId: item.id,
        title: item.name || '',
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
  capabilities: ['search', 'product', 'media', 'trailer', 'steamSpyFallback', 'optionalOfficialAppList'],
  search,
  product: appDetails,
  appList,
  health: async () => {
    const result = await appDetails('570', { force: true });
    return {
      ok: Boolean(result?.title),
      sample: result?.title || null,
      fallback: result?.rawHints?.source || null,
      documentedListAvailable: Boolean(config.steamWebApiKey)
    };
  }
};
