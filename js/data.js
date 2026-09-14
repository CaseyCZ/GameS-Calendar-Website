const DB_NAME = 'games-calendar-cache';
const DB_VERSION = 1;
const STORE = 'responses';
const CACHE_KEY = 'games-catalog-v8';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const LIVE_CATALOG_URL = globalThis.location?.hostname?.endsWith('.github.io') ? null : '/games-api/catalog?view=list';
const LIVE_DETAIL_URL = globalThis.location?.hostname?.endsWith('.github.io') ? null : '/games-api/catalog/game';
const LIVE_DISCOVER_URL = globalThis.location?.hostname?.endsWith('.github.io') ? null : '/games-api/discover';
const LIVE_CATALOG_META_URL = globalThis.location?.hostname?.endsWith('.github.io') ? null : '/games-api/catalog-meta';
const STATIC_CATALOG_URL = 'games.json';

let sharedLoadPromise = null;
let revalidationPromise = null;
const revalidationCallbacks = new Set();
const detailCache = new Map();

const pad = value => String(value).padStart(2, '0');

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDay(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  let ms;
  if (typeof value === 'number') ms = value > 1e12 ? value : value * 1000;
  else if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    ms = n > 1e12 ? n : n * 1000;
  } else ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayToTimestamp(day) {
  if (!day) return 0;
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

export function addDays(day, amount) {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function monthRange(year, monthIndex) {
  const start = new Date(Date.UTC(Number(year), Number(monthIndex), 1));
  const end = new Date(Date.UTC(Number(year), Number(monthIndex) + 1, 0));
  return {
    from: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`,
    to: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  };
}

export function platformGroup(name = '') {
  const n = String(name).trim().toLowerCase();
  if (n.includes('switch 2') || n === 'nsw2') return 'Switch 2';
  if (n.includes('playstation 5') || n === 'ps5') return 'PS5';
  if (n.includes('xbox') || /^(xone|x360|xsx|xb1)$/.test(n)) return 'Xbox Series';
  if (n.includes('nintendo switch') || n === 'switch' || n === 'nsw') return 'Switch';
  if (/quest|rift|steamvr|playstation vr|\bvr\b|virtual reality/.test(n)) return 'VR';
  if (/\bpc\b|windows|linux|mac|steam|^win$/.test(n)) return 'PC';
  return 'Other';
}

export const PLATFORM_GROUPS = [
  { key: 'PC', label: 'PC', icon: '▣' },
  { key: 'PS5', label: 'PS5', icon: 'PS' },
  { key: 'Xbox Series', label: 'Xbox', icon: 'X' },
  { key: 'Switch', label: 'Switch', icon: 'N' },
  { key: 'Switch 2', label: 'Switch 2', icon: 'N2' },
  { key: 'VR', label: 'VR', icon: 'VR' }
];

function normalizeCover(url) {
  if (!url) return '';
  let value = String(url);
  if (value.startsWith('//')) value = `https:${value}`;
  return value.replace(/\/t_[a-zA-Z0-9_]+\//, '/t_cover_big/');
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizePlatform(platform) {
  if (!platform) return null;
  if (typeof platform === 'string') return { id: null, name: platform, abbreviation: '', group: platformGroup(platform) };
  const name = platform.name || platform.abbreviation || platform.abbr || String(platform.id || '');
  return {
    id: platform.id ?? null,
    name,
    abbreviation: platform.abbreviation || platform.abbr || '',
    group: platform.group || platformGroup(name)
  };
}

function normalizeLinks(links = {}, game = {}) {
  return {
    official: links.official || '',
    steam: links.steam || '',
    epic: links.epic || '',
    reddit: links.reddit || '',
    youtube: links.youtube || '',
    wikipedia: links.wikipedia || '',
    igdb: links.igdb || game.igdbUrl || game.url || ''
  };
}

function normalizeScreenshot(item) {
  if (!item) return null;
  if (typeof item === 'string') return { full: item, thumb: item };
  const full = item.full || item.path_full || item.url || '';
  const thumb = item.thumb || item.path_thumbnail || full;
  return full ? { full, thumb } : null;
}

function normalizeRelease(release = {}) {
  const day = toDay(release.date ?? release.day ?? release.timestamp);
  const window = String(release.window || release.releaseWindow || release.label || '').trim();
  if (!day && !window) return null;
  const platforms = (release.platforms || []).map(normalizePlatform).filter(Boolean);
  return {
    day,
    timestamp: release.timestamp || (day ? dayToTimestamp(day) : 0),
    platforms,
    window,
    precision: release.precision || release.datePrecision || (day ? 'day' : 'unknown'),
    regions: uniq(release.regions || [])
  };
}

function normalizeGame(game = {}) {
  const releases = (game.releases || []).map(normalizeRelease).filter(Boolean).sort((a, b) => {
    const ak = a.day || '9999-12-31';
    const bk = b.day || '9999-12-31';
    return ak.localeCompare(bk);
  });

  return {
    id: game.id ?? game.slug ?? game.name,
    name: game.name || 'Neznámá hra',
    slug: game.slug || '',
    aliases: uniq(game.aliases || game.alternativeNames || []),
    summary: game.summary || '',
    summarySource: game.summarySource || '',
    storyline: game.storyline || '',
    cover: normalizeCover(game.cover),
    genres: uniq((game.genres || []).map(item => typeof item === 'string' ? item : item?.name)),
    developers: uniq((game.developers || []).map(item => typeof item === 'string' ? item : item?.name)),
    publishers: uniq((game.publishers || []).map(item => typeof item === 'string' ? item : item?.name)),
    series: uniq((game.series || []).map(item => typeof item === 'string' ? item : item?.name)),
    scale: game.scale || '',
    contentType: game.contentType || '',
    earlyAccess: Boolean(game.earlyAccess),
    storeCategories: uniq(game.storeCategories || []),
    metadataSources: uniq(game.metadataSources || []),
    steamId: game.steamId ? String(game.steamId) : '',
    rating: Number(game.rating || game.totalRating || 0) || 0,
    ratingCount: Number(game.ratingCount || game.totalRatingCount || 0) || 0,
    igdbUrl: game.igdbUrl || game.url || '',
    trailerId: game.trailerId || '',
    trailerUrl: game.trailerUrl || '',
    trailerPoster: game.trailerPoster || '',
    screenshots: uniq((game.screenshots || []).map(normalizeScreenshot).filter(Boolean).map(item => JSON.stringify(item))).map(item => JSON.parse(item)),
    hasScreenshots: Boolean(game.hasScreenshots || (game.screenshots || []).length),
    hasDescription: Boolean(game.hasDescription || String(game.summary || game.storyline || '').trim()),
    subscriptions: {
      gamePass: Boolean(game.subscriptions?.gamePass),
      gamePassConsole: Boolean(game.subscriptions?.gamePassConsole),
      gamePassPc: Boolean(game.subscriptions?.gamePassPc),
      cloudGaming: Boolean(game.subscriptions?.cloudGaming),
      psPlus: Boolean(game.subscriptions?.psPlus),
      geforceNow: Boolean(game.subscriptions?.geforceNow),
      checkedAt: game.subscriptions?.checkedAt || null,
      gamePassCheckedAt: game.subscriptions?.gamePassCheckedAt || null,
      gamePassSource: game.subscriptions?.gamePassSource || '',
      gamePassProductId: game.subscriptions?.gamePassProductId || ''
    },
    regionalReleases: Array.isArray(game.regionalReleases) ? game.regionalReleases : [],
    announcedWindow: game.announcedWindow || '',
    links: normalizeLinks(game.links, game),
    releases
  };
}

function normalizeV2(payload) {
  const games = (payload.games || []).map(normalizeGame).filter(game => game.releases.length > 0);
  return {
    version: payload.version || 2,
    generatedAt: payload.generatedAt || null,
    range: payload.range || null,
    provider: payload.provider || '',
    games
  };
}

function normalizeLegacy(items) {
  const gameMap = new Map();
  for (const item of items || []) {
    const nested = item.game || item;
    const name = nested?.name || item?.name;
    const day = toDay(item.date ?? item.first_release_date ?? nested?.first_release_date);
    if (!name || !day) continue;
    const gameId = nested?.id ?? item.game_id ?? name.toLowerCase();
    const key = String(gameId);
    if (!gameMap.has(key)) {
      gameMap.set(key, normalizeGame({
        ...nested,
        id: gameId,
        name,
        cover: nested.cover?.url || nested.cover || item.cover?.url || item.cover,
        trailerId: nested.videos?.[0]?.video_id || '',
        links: normalizeLinks({}, nested),
        releases: []
      }));
      gameMap.get(key).releases = [];
    }
    const game = gameMap.get(key);
    let release = game.releases.find(r => r.day === day);
    if (!release) {
      release = { day, timestamp: dayToTimestamp(day), platforms: [], window: '', precision: 'day', regions: [] };
      game.releases.push(release);
    }
    const sourcePlatforms = item.platforms || nested.platforms || (item.platform ? [item.platform] : []);
    for (const p of sourcePlatforms) {
      const normalized = normalizePlatform(p);
      if (normalized && !release.platforms.some(existing => existing.name === normalized.name)) release.platforms.push(normalized);
    }
  }
  const games = [...gameMap.values()];
  for (const game of games) game.releases.sort((a, b) => (a.day || '').localeCompare(b.day || ''));
  const days = games.flatMap(game => game.releases.map(r => r.day).filter(Boolean)).sort();
  return {
    version: 1,
    generatedAt: null,
    range: days.length ? { from: days[0], to: days.at(-1) } : null,
    provider: '',
    games
  };
}

export function normalizePayload(payload) {
  if (Array.isArray(payload)) return normalizeLegacy(payload);
  if (payload && Array.isArray(payload.games)) return normalizeV2(payload);
  throw new Error('Zdroj her má neznámý formát.');
}

export function flattenReleases(dataset) {
  const rows = [];
  for (const game of dataset.games) {
    for (let index = 0; index < game.releases.length; index += 1) {
      const release = game.releases[index];
      rows.push({
        key: `${game.id}:${release.day || `window-${index}`}`,
        game,
        day: release.day,
        timestamp: release.timestamp,
        platforms: release.platforms,
        platformGroups: uniq(release.platforms.map(p => p.group || platformGroup(p.name))),
        window: release.window,
        precision: release.precision,
        regions: release.regions
      });
    }
  }
  return rows.sort((a, b) => {
    const ak = a.day || '9999-12-31';
    const bk = b.day || '9999-12-31';
    return ak.localeCompare(bk) || a.game.name.localeCompare(b.game.name, 'cs');
  });
}

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readCache() {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(CACHE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function writeCache(payload) {
  const db = await openDb();
  if (!db) return;
  await new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ payload, savedAt: Date.now() }, CACHE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadGameDetail(game) {
  if (!LIVE_DETAIL_URL || !game?.id) return null;
  const key = String(game.id);
  if (!detailCache.has(key)) {
    const request = fetchJson(`${LIVE_DETAIL_URL}/${encodeURIComponent(key)}`)
      .then(normalizeGame)
      .catch(error => {
        detailCache.delete(key);
        throw error;
      });
    detailCache.set(key, request);
  }
  return detailCache.get(key);
}

export async function searchOnlineGames(query, { limit = 500 } = {}) {
  const q = String(query || '').trim();
  if (!LIVE_DISCOVER_URL || q.length < 3) return [];
  const take = Math.max(1, Math.min(500, Number(limit) || 500));
  const payload = await fetchJson(`${LIVE_DISCOVER_URL}?q=${encodeURIComponent(q)}&limit=${take}`);
  return (payload.games || []).map(normalizeGame).filter(game => game.releases.length > 0);
}

async function fetchPayload() {
  let liveError = null;
  if (LIVE_CATALOG_URL) {
    try {
      const payload = await fetchJson(LIVE_CATALOG_URL);
      await writeCache(payload);
      return { payload, source: 'live-api' };
    } catch (error) {
      liveError = error;
    }
  }

  try {
    const payload = await fetchJson(STATIC_CATALOG_URL);
    await writeCache(payload);
    return { payload, source: 'games-json', liveError };
  } catch (fallbackError) {
    throw new Error(`Živé API i games.json selhaly: ${liveError?.message || 'API error'}; ${fallbackError.message}`);
  }
}

async function revalidateCache(cached, dataset) {
  if (!LIVE_CATALOG_META_URL || revalidationPromise) return revalidationPromise;
  revalidationPromise = (async () => {
    const meta = await fetchJson(LIVE_CATALOG_META_URL);
    const before = String(dataset.generatedAt || cached.savedAt);
    const after = String(meta.generatedAt || '');
    if (!after || before === after) return;
    const { payload } = await fetchPayload();
    const fresh = normalizePayload(payload);
    for (const callback of revalidationCallbacks) callback(fresh);
  })().catch(() => {}).finally(() => { revalidationPromise = null; });
  return revalidationPromise;
}

async function loadGameDataOnce() {
  const cached = await readCache();
  const isFresh = cached && Date.now() - cached.savedAt < CACHE_TTL;

  if (isFresh) {
    const dataset = normalizePayload(cached.payload);
    revalidateCache(cached, dataset);
    return { dataset, rawPayload: cached.payload, source: 'cache', stale: false };
  }

  try {
    const { payload, source, liveError } = await fetchPayload();
    return {
      dataset: normalizePayload(payload),
      rawPayload: payload,
      source,
      stale: false,
      liveError: liveError || null
    };
  } catch (error) {
    if (cached?.payload) {
      return { dataset: normalizePayload(cached.payload), rawPayload: cached.payload, source: 'cache', stale: true, error };
    }
    throw error;
  }
}

export function loadGameData({ onRevalidated } = {}) {
  if (typeof onRevalidated === 'function') revalidationCallbacks.add(onRevalidated);
  if (!sharedLoadPromise) {
    sharedLoadPromise = loadGameDataOnce().catch(error => {
      sharedLoadPromise = null;
      throw error;
    });
  }
  return sharedLoadPromise;
}
