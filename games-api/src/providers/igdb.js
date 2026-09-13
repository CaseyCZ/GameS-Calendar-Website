import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchResponse, fetchJson } from '../lib/http.js';
import { canonicalGame, isoDate, uniq } from '../lib/normalize.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_ROOT = 'https://api.igdb.com/v4';
const MIN_REQUEST_GAP_MS = 275; // Stay below IGDB's 4 requests/second limit.

let tokenState = { token: '', expiresAt: 0 };
let requestGate = Promise.resolve();
let nextRequestAt = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function configured() {
  return Boolean(config.igdbClientId && config.igdbClientSecret);
}

async function accessToken({ force = false } = {}) {
  if (!configured()) throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not configured');
  const now = Date.now();
  if (!force && tokenState.token && tokenState.expiresAt > now + 5 * 60_000) return tokenState.token;

  const body = new URLSearchParams({
    client_id: config.igdbClientId,
    client_secret: config.igdbClientSecret,
    grant_type: 'client_credentials'
  });
  const payload = await fetchJson(TOKEN_URL, {
    method: 'POST',
    body,
    attempts: 2,
    timeoutMs: 10_000,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  if (!payload?.access_token) throw new Error('Twitch did not return an IGDB app access token');
  const ttlMs = Math.max(60_000, Number(payload.expires_in || 0) * 1000);
  tokenState = { token: payload.access_token, expiresAt: Date.now() + ttlMs };
  return tokenState.token;
}

async function throttle() {
  let release;
  const previous = requestGate;
  requestGate = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
  } finally {
    release();
  }
}

async function request(endpoint, query, { retryAuth = true } = {}) {
  await throttle();
  const token = await accessToken();
  const response = await fetchResponse(`${API_ROOT}/${endpoint}`, {
    method: 'POST',
    body: query,
    timeoutMs: 15_000,
    attempts: 2,
    headers: {
      'Client-ID': config.igdbClientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'content-type': 'text/plain'
    }
  });
  const text = await response.text();
  if (response.status === 401 && retryAuth) {
    tokenState = { token: '', expiresAt: 0 };
    await accessToken({ force: true });
    return request(endpoint, query, { retryAuth: false });
  }
  if (!response.ok) throw new Error(`IGDB HTTP ${response.status}: ${text.slice(0, 240)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid IGDB JSON: ${text.slice(0, 240)}`); }
}

function imageUrl(imageId, size) {
  if (!imageId) return '';
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

function sourceName(item) {
  const expanded = item?.external_game_source;
  if (typeof expanded?.name === 'string') return expanded.name;
  if (typeof expanded === 'string') return expanded;
  const legacy = Number(item?.category);
  const known = {
    1: 'Steam',
    5: 'GOG',
    11: 'Microsoft',
    26: 'Epic Games Store',
    28: 'Oculus',
    31: 'Xbox Marketplace',
    36: 'PlayStation Store US',
    54: 'Xbox Game Pass Ultimate Cloud'
  };
  return known[legacy] || (legacy ? `source-${legacy}` : 'unknown');
}

function externalIds(items = []) {
  const out = {};
  for (const item of items) {
    const name = sourceName(item).toLowerCase();
    const value = String(item?.uid || '').trim();
    if (!value) continue;
    let key = name.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (/steam/.test(name)) key = 'steam';
    else if (/playstation/.test(name)) key = 'playstation';
    else if (/xbox.*cloud|game pass.*cloud/.test(name)) key = 'xboxCloud';
    else if (/xbox/.test(name)) key = 'xbox';
    else if (/microsoft/.test(name)) key = 'microsoft';
    else if (/epic/.test(name)) key = 'epic';
    else if (/gog/.test(name)) key = 'gog';
    if (!out[key]) out[key] = value;
  }
  return out;
}

function idsFromWebsites(urls = []) {
  const out = {};
  for (const raw of urls) {
    let url;
    try { url = new URL(raw); }
    catch { continue; }
    const href = url.href;

    const steam = href.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (steam && !out.steam) out.steam = steam[1];

    const xbox = href.match(/(?:xbox\.com|apps\.microsoft\.com)\/[^?#]*\/([A-Z0-9]{10,16})(?:[/?#]|$)/i);
    if (xbox && !out.microsoft) {
      out.microsoft = xbox[1].toUpperCase();
      out.xbox = out.microsoft;
    }

    const psProduct = href.match(/store\.playstation\.com\/[^?#]*\/product\/([^/?#]+)/i);
    if (psProduct && !out.playstationProduct) out.playstationProduct = decodeURIComponent(psProduct[1]);

    const psConcept = href.match(/store\.playstation\.com\/[^?#]*\/concept\/([^/?#]+)/i);
    if (psConcept && !out.playstationConcept) out.playstationConcept = decodeURIComponent(psConcept[1]);
  }
  return out;
}

function companyLists(items = []) {
  const developers = [];
  const publishers = [];
  for (const item of items) {
    const name = item?.company?.name;
    if (!name) continue;
    if (item.developer) developers.push(name);
    if (item.publisher) publishers.push(name);
  }
  return { developers: uniq(developers), publishers: uniq(publishers) };
}

function normalizeIgdb(game) {
  if (!game) return null;
  const companies = companyLists(game.involved_companies || []);
  const releases = (game.release_dates || []).map(item => ({
    day: item?.date ? isoDate(new Date(Number(item.date) * 1000).toISOString()) : null,
    platform: item?.platform?.abbreviation || item?.platform?.name || ''
  })).filter(item => item.day || item.platform);
  const screenshots = (game.screenshots || []).map(item => imageUrl(item?.image_id, 'screenshot_big_2x')).filter(Boolean);
  const videos = (game.videos || []).map(item => ({
    id: String(item?.video_id || ''),
    name: item?.name || '',
    url: item?.video_id ? `https://www.youtube.com/watch?v=${item.video_id}` : ''
  })).filter(item => item.id);
  const firstRelease = game.first_release_date ? new Date(Number(game.first_release_date) * 1000).toISOString() : null;
  const rating = Number(game.total_rating || game.aggregated_rating || game.rating || 0) || null;
  const ratingCount = Number(game.total_rating_count || game.aggregated_rating_count || game.rating_count || 0) || null;
  const websites = (game.websites || []).map(item => item?.url).filter(Boolean);
  const ids = { ...externalIds(game.external_games || []), ...idsFromWebsites(websites) };

  const normalized = canonicalGame('igdb', {
    providerId: game.id,
    title: game.name || '',
    description: game.summary || game.storyline || '',
    shortDescription: game.summary || '',
    developers: companies.developers,
    publishers: companies.publishers,
    genres: (game.genres || []).map(item => item?.name).filter(Boolean),
    categories: uniq([
      ...(game.themes || []).map(item => item?.name).filter(Boolean),
      ...(game.game_modes || []).map(item => item?.name).filter(Boolean)
    ]),
    platforms: (game.platforms || []).map(item => item?.abbreviation || item?.name).filter(Boolean),
    releaseDate: firstRelease,
    rating,
    ratingCount,
    media: {
      cover: imageUrl(game.cover?.image_id, 'cover_big_2x'),
      hero: imageUrl(game.artworks?.[0]?.image_id, '1080p_2x'),
      screenshots,
      trailers: videos.map(item => item.url).filter(Boolean)
    },
    storeUrl: game.slug ? `https://www.igdb.com/games/${game.slug}` : '',
    sourceUrl: `${API_ROOT}/games`,
    rawHints: {
      gameType: game.game_type?.type || game.game_type || null,
      externalIds: ids,
      aliases: (game.alternative_names || []).map(item => item?.name).filter(Boolean),
      collections: (game.collections || []).map(item => item?.name).filter(Boolean),
      franchises: (game.franchises || []).map(item => item?.name).filter(Boolean),
      gameModes: (game.game_modes || []).map(item => item?.name).filter(Boolean),
      perspectives: (game.player_perspectives || []).map(item => item?.name).filter(Boolean),
      themes: (game.themes || []).map(item => item?.name).filter(Boolean),
      releaseDates: releases,
      videos,
      websites
    }
  });
  normalized.externalIds = ids;
  normalized.aliases = normalized.rawHints.aliases;
  normalized.series = uniq([...normalized.rawHints.collections, ...normalized.rawHints.franchises]);
  normalized.gameModes = normalized.rawHints.gameModes;
  normalized.perspectives = normalized.rawHints.perspectives;
  normalized.themes = normalized.rawHints.themes;
  normalized.releaseDates = releases;
  normalized.videos = videos;
  normalized.websites = websites;
  normalized.gameType = normalized.rawHints.gameType;
  return normalized;
}

const GAME_FIELDS = [
  'id','name','slug','summary','storyline','first_release_date',
  'rating','rating_count','aggregated_rating','aggregated_rating_count','total_rating','total_rating_count',
  'game_type.type','genres.name','game_modes.name','player_perspectives.name','themes.name',
  'platforms.name','platforms.abbreviation','cover.image_id','artworks.image_id','screenshots.image_id',
  'videos.video_id','videos.name','alternative_names.name','collections.name','franchises.name',
  'involved_companies.company.name','involved_companies.developer','involved_companies.publisher',
  'release_dates.date','release_dates.platform.name','release_dates.platform.abbreviation',
  'external_games.uid','external_games.url','external_games.category','external_games.external_game_source.name',
  'websites.url'
].join(',');

function escapeSearch(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function product(id, { force = false } = {}) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error('Invalid IGDB game ID');
  const key = `igdb:game:${numeric}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const payload = await request('games', `fields ${GAME_FIELDS}; where id = ${numeric}; limit 1;`);
  const item = normalizeIgdb(payload?.[0]);
  if (!item) throw new Error(`IGDB game ${numeric} not found`);
  return cachePut(key, 'igdb', item, config.ttl.igdb || config.ttl.product);
}

export async function search(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(20, Number(limit) || 8));
  const key = `igdb:search:${q.toLowerCase()}:${take}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, take);
  }
  const body = `search "${escapeSearch(q)}"; fields ${GAME_FIELDS}; where version_parent = null; limit ${take};`;
  const payload = await request('games', body);
  const items = (payload || []).map(normalizeIgdb).filter(Boolean);
  cachePut(key, 'igdb', items, config.ttl.search);
  return items.slice(0, take);
}

export const igdbProvider = {
  name: 'igdb',
  capabilities: ['search','product','metadata','externalIds','releaseDates','media','videos'],
  search,
  product,
  health: async () => {
    if (!configured()) return { ok: true, configured: false, skipped: true };
    const hits = await search('Halo', { force: true, limit: 1 });
    return { ok: Boolean(hits[0]?.title), configured: true, sample: hits[0]?.title || null };
  }
};
