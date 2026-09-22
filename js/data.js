const DB_NAME = 'games-calendar-cache';
const DB_VERSION = 1;
const STORE = 'responses';
const CACHE_KEY = 'games-catalog-v10';
const CACHE_TTL = 2 * 60 * 60 * 1000;
const IS_GITHUB_PAGES = Boolean(globalThis.location?.hostname?.endsWith('.github.io'));
const REMOTE_API_ROOTS = [
  'https://130.61.49.108/games-api',
  'https://130.61.49.108:8443/games-api'
];
const LIVE_API_ROOTS = IS_GITHUB_PAGES ? REMOTE_API_ROOTS : ['/games-api'];
const LIVE_CATALOG_URL = IS_GITHUB_PAGES ? null : `${LIVE_API_ROOTS[0]}/catalog?view=list`;
const LIVE_DETAIL_URLS = LIVE_API_ROOTS.map(root => `${root}/catalog/game`);
const LIVE_DISCOVER_URLS = LIVE_API_ROOTS.map(root => `${root}/discover`);
const LIVE_CATALOG_META_URL = IS_GITHUB_PAGES ? null : `${LIVE_API_ROOTS[0]}/catalog-meta`;
const STATIC_CATALOG_URLS = ['games-index.json', 'games.json'];
const STATIC_DETAIL_URL = 'games.json';

let sharedLoadPromise = null;
let revalidationPromise = null;
const revalidationCallbacks = new Set();
const detailCache = new Map();
let staticDetailDatasetPromise = null;

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

const RELEASE_MONTHS = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,
  nov:11,november:11,dec:12,december:12,
  leden:1,unor:2,únor:2,brezen:3,březen:3,duben:4,kveten:5,květen:5,cerven:6,červen:6,
  cervenec:7,červenec:7,srpen:8,zari:9,září:9,rijen:10,říjen:10,listopad:11,prosinec:12
};

function releaseYearFromWindow(window = '') {
  return Number(String(window).match(/\b(20\d{2})\b/)?.[1] || 0);
}

export function releaseBounds(release = {}) {
  const day = toDay(release.day ?? release.date ?? release.timestamp);
  if (day && String(release.precision || 'day').toLowerCase() === 'day') return { from: day, to: day, sortDay: day };

  const precision = String(release.precision || release.datePrecision || (day ? 'day' : 'unknown')).toLowerCase();
  const window = String(release.window || release.releaseWindow || release.label || '').trim();
  const year = releaseYearFromWindow(window) || Number(day?.slice(0, 4) || 0);
  if (!year) return { from: null, to: null, sortDay: day || null };

  if (precision === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31`, sortDay: `${year}-07-01` };
  }

  const quarter = precision.match(/^q([1-4])$/) || window.toLowerCase().match(/\bq([1-4])\b/);
  if (quarter) {
    const q = Number(quarter[1]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return {
      from: `${year}-${pad(startMonth)}-01`,
      to: `${year}-${pad(endMonth)}-${pad(endDay)}`,
      sortDay: `${year}-${pad(startMonth + 1)}-15`
    };
  }

  if (precision === 'month') {
    const numeric = window.match(/\b(0?[1-9]|1[0-2])[\/. -](20\d{2})\b/);
    const lower = window.toLocaleLowerCase('cs');
    const named = Object.entries(RELEASE_MONTHS).find(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(lower));
    const month = Number(numeric?.[1] || named?.[1] || day?.slice(5, 7) || 0);
    if (month) {
      const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        from: `${year}-${pad(month)}-01`,
        to: `${year}-${pad(month)}-${pad(endDay)}`,
        sortDay: `${year}-${pad(month)}-15`
      };
    }
  }

  return { from: day || null, to: day || null, sortDay: day || null };
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
    playstation: links.playstation || links.psStore || '',
    xbox: links.xbox || links.microsoftStore || '',
    nintendo: links.nintendo || links.nintendoStore || '',
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
  const precision = String(release.precision || release.datePrecision || (day ? 'day' : 'unknown')).toLowerCase();
  const normalizedDay = precision === 'day' ? day : null;
  const bounds = releaseBounds({ ...release, day: normalizedDay, window, precision });
  return {
    day: normalizedDay,
    timestamp: normalizedDay ? (release.timestamp || dayToTimestamp(normalizedDay)) : 0,
    platforms,
    window,
    precision,
    precisionSource: release.precisionSource || '',
    regions: uniq(release.regions || []),
    from: bounds.from,
    to: bounds.to,
    sortDay: bounds.sortDay
  };
}

function normalizeGame(game = {}) {
  const releases = (game.releases || []).map(normalizeRelease).filter(Boolean).sort((a, b) => {
    const ak = a.sortDay || a.day || '9999-12-31';
    const bk = b.sortDay || b.day || '9999-12-31';
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
        regions: release.regions,
        from: release.from,
        to: release.to,
        sortDay: release.sortDay
      });
    }
  }
  return rows.sort((a, b) => {
    const ak = a.sortDay || a.day || '9999-12-31';
    const bk = b.sortDay || b.day || '9999-12-31';
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

async function fetchJson(url, retry = 0) {
  const response = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (!response.ok && [502, 503, 504].includes(response.status) && retry < 2) {
    await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
    return fetchJson(url, retry + 1);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function fetchFirstJson(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Live API endpoint is not available');
}

async function loadStaticDetailDataset() {
  if (!staticDetailDatasetPromise) {
    staticDetailDatasetPromise = fetchJson(STATIC_DETAIL_URL)
      .then(normalizePayload)
      .catch(error => {
        staticDetailDatasetPromise = null;
        throw error;
      });
  }
  return staticDetailDatasetPromise;
}

export async function loadGameDetail(game) {
  if (!game?.id) return null;
  const key = String(game.id);
  if (!detailCache.has(key)) {
    const request = (async () => {
      try {
        if (LIVE_DETAIL_URLS.length) {
          const payload = await fetchFirstJson(LIVE_DETAIL_URLS.map(base => `${base}/${encodeURIComponent(key)}`));
          return normalizeGame(payload);
        }
      } catch {}
      const dataset = await loadStaticDetailDataset();
      const exact = dataset.games.find(item =>
        String(item.id) === key
        || (game.igdbId && String(item.igdbId || '') === String(game.igdbId))
      );
      return exact || normalizeGame(game);
    })().catch(error => {
      detailCache.delete(key);
      throw error;
    });
    detailCache.set(key, request);
  }
  return detailCache.get(key);
}

export async function searchOnlineGames(query, { limit = 500 } = {}) {
  const q = String(query || '').trim();
  if (!LIVE_DISCOVER_URLS.length || q.length < 2) return [];
  const take = Math.max(1, Math.min(500, Number(limit) || 500));
  const suffix = `?q=${encodeURIComponent(q)}&limit=${take}`;
  const payload = await fetchFirstJson(LIVE_DISCOVER_URLS.map(base => `${base}${suffix}`));
  return [...new Map(
    (payload.games || [])
      .map(normalizeGame)
      .filter(Boolean)
      .map(game => [String(game.id), game])
  ).values()];
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
    const payload = await fetchFirstJson(STATIC_CATALOG_URLS);
    await writeCache(payload);
    return { payload, source: payload?.compact ? 'compact-index' : 'games-json', liveError };
  } catch (fallbackError) {
    throw new Error(`Živé API i statický katalog selhaly: ${liveError?.message || 'API error'}; ${fallbackError.message}`);
  }
}

async function revalidateCache(cached, dataset) {
  if (revalidationPromise) return revalidationPromise;
  revalidationPromise = (async () => {
    const before = String(dataset.generatedAt || cached.savedAt);

    if (LIVE_CATALOG_META_URL) {
      const meta = await fetchJson(LIVE_CATALOG_META_URL);
      const after = String(meta.generatedAt || '');
      if (!after || before === after) return;
      const { payload } = await fetchPayload();
      const fresh = normalizePayload(payload);
      for (const callback of revalidationCallbacks) callback(fresh);
      return;
    }

    const payload = await fetchJson(STATIC_CATALOG_URLS[0]);
    const after = String(payload?.generatedAt || '');
    if (!after || before === after) return;
    await writeCache(payload);
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
