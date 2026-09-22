import {
  PLATFORM_GROUPS,
  addDays,
  flattenReleases,
  loadGameData,
  loadGameDetail,
  monthRange,
  platformGroup,
  searchOnlineGames,
  todayLocal
} from './data.js';
import { downloadIcs, googleCalendarUrl } from './calendar.js';
import { platformIcon } from './icons.js';
import {
  MONTHS,
  escapeHtml,
  formatDate,
  formatGenre,
  formatMonth,
  formatter,
  gameDialogHtml,
  rowCard
} from './ui.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 72;
const MAX_GENRE_FILTERS = 32;
const WATCH_KEY = 'games-calendar-watchlist-v2';
const VIEW_KEY = 'games-calendar-view-v2';
const PLATFORM_PREF_KEY = 'games-calendar-my-platforms-v1';
const NOTIFY_KEY = 'games-calendar-notifications-v1';
const PUSH_PUBLIC_KEY_URL = '/games-api/push/public-key';
const PUSH_SUBSCRIBE_URL = '/games-api/push/subscribe';
const CALENDAR_FEED_URL = '/games-api/calendar.ics';
const DEFAULT_TITLE = 'Herní Kalendář – nové hry pro PC, PS5, Xbox a Nintendo';
const DEFAULT_DESCRIPTION = 'Přehled připravovaných a vydaných her, termínů, platforem, žánrů a odkazů na obchody.';

function debounce(fn, wait = 180) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

function readJsonSet(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch { return new Set(); }
}

function saveJsonSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

const gameId = game => String(game.id);
const readWatchlist = () => readJsonSet(WATCH_KEY);
const readPlatformPrefs = () => readJsonSet(PLATFORM_PREF_KEY);

const state = {
  dataset: null,
  rows: [],
  catalogRows: [],
  onlineRows: [],
  onlineSearchLoading: false,
  filtered: [],
  search: '',
  platforms: new Set(),
  genres: new Set(),
  company: null,
  series: '',
  status: 'upcoming',
  precision: 'all',
  period: 'all',
  range: null,
  sort: 'date-asc',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  watchlistOnly: false,
  watchlist: readWatchlist(),
  savedPlatforms: readPlatformPrefs(),
  queryHadPlatforms: false,
  requestedGameId: '',
  requestedRelease: '',
  openRowKey: '',
  limit: PAGE_SIZE
};

let onlineSearchSequence = 0;
let calendarFeedMode = 'watch';

const isWatched = game => state.watchlist.has(gameId(game));

function normalizeSearch(value = '') {
  const roman = new Map([
    ['i','1'],['ii','2'],['iii','3'],['iv','4'],['v','5'],['vi','6'],['vii','7'],['viii','8'],['ix','9'],['x','10']
  ]);
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(token => roman.get(token) || token)
    .join(' ');
}

function gameSearchText(game) {
  return normalizeSearch([
    game.name,
    ...(game.aliases || []),
    ...(game.developers || []),
    ...(game.publishers || []),
    ...(game.series || [])
  ].join(' '));
}

function searchRelevance(game, query) {
  const q = normalizeSearch(query);
  const name = normalizeSearch(game.name);
  const aliases = (game.aliases || []).map(normalizeSearch);
  if (!q) return 0;
  if (name == q) return 100;
  if (aliases.includes(q)) return 95;
  if (name.startsWith(q)) return 85;
  if (name.includes(q)) return 75;
  if (aliases.some(alias => alias.startsWith(q))) return 70;
  const words = q.split(' ').filter(Boolean);
  return words.filter(word => gameSearchText(game).includes(word)).length / Math.max(1, words.length) * 50;
}

function matchesSearch(game, query) {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  const haystack = gameSearchText(game);
  return haystack.includes(needle)
    || needle.split(' ').filter(Boolean).every(word => haystack.includes(word));
}

function uniqueGameCount(rows) {
  return new Set(rows.map(row => gameId(row.game))).size;
}

function setDefaultPeriod() {
  state.period = 'all';
  state.range = null;
}

function rangeForPeriod(kind) {
  const today = todayLocal();
  const now = new Date(`${today}T00:00:00Z`);
  if (kind === 'week') {
    const weekday = now.getUTCDay() || 7;
    const from = addDays(today, 1 - weekday);
    return { from, to:addDays(from, 6) };
  }
  if (kind === '30') return { from:today, to:addDays(today, 29) };
  if (kind === '90') return { from:today, to:addDays(today, 89) };
  if (kind === 'year') return { from:`${now.getUTCFullYear()}-01-01`, to:`${now.getUTCFullYear()}-12-31` };
  if (kind === 'next') return monthRange(now.getUTCFullYear(), now.getUTCMonth() + 1);
  if (kind === 'month') return monthRange(now.getUTCFullYear(), now.getUTCMonth());
  return null;
}

function parseQuery() {
  const query = new URLSearchParams(location.search);
  if (query.has('q')) state.search = query.get('q') || '';
  if (query.has('platforms')) {
    state.queryHadPlatforms = true;
    state.platforms = new Set(query.get('platforms').split(',').filter(Boolean));
  }
  if (query.has('genres')) state.genres = new Set(query.get('genres').split(',').filter(Boolean));
  else if (query.has('genre')) state.genres = new Set([query.get('genre')].filter(Boolean));
  if (query.has('developer')) state.company = { type: 'developer', value: query.get('developer') || '' };
  if (query.has('publisher')) state.company = { type: 'publisher', value: query.get('publisher') || '' };
  if (query.has('series')) state.series = query.get('series') || '';
  if (['upcoming','released','all'].includes(query.get('status'))) state.status = query.get('status');
  if (['all','day','month','quarter','year','unknown'].includes(query.get('precision'))) state.precision = query.get('precision');
  if (['date-asc','date-desc','name-asc','name-desc'].includes(query.get('sort'))) state.sort = query.get('sort');
  else if (state.search) state.sort = 'date-desc';
  if (['grid','compact'].includes(query.get('view'))) state.view = query.get('view');
  state.requestedGameId = query.get('game') || '';
  state.requestedRelease = query.get('release') || '';

  const from = query.get('from');
  const to = query.get('to');
  const month = query.get('month');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to) {
    state.period = 'custom'; state.range = {from, to};
  } else if (/^\d{4}-\d{2}$/.test(month || '')) {
    const [year, m] = month.split('-').map(Number);
    state.period = 'month'; state.range = monthRange(year, m - 1);
  } else if (['all','next','week','30','90','year','undated'].includes(query.get('period'))) {
    state.period = query.get('period');
    state.range = rangeForPeriod(state.period);
  }
}

function buildQuery({ includeOpenGame = true } = {}) {
  const q = new URLSearchParams();
  if (state.search) q.set('q', state.search);
  if (state.platforms.size) q.set('platforms', [...state.platforms].join(','));
  if (state.genres.size) q.set('genres', [...state.genres].join(','));
  if (state.company?.type === 'developer') q.set('developer', state.company.value);
  if (state.company?.type === 'publisher') q.set('publisher', state.company.value);
  if (state.series) q.set('series', state.series);
  if (state.status !== 'upcoming') q.set('status', state.status);
  if (state.precision !== 'all') q.set('precision', state.precision);
  if (state.sort !== 'date-asc') q.set('sort', state.sort);
  if (state.view !== 'grid') q.set('view', state.view);
  if (['next','week','30','90','year','undated'].includes(state.period)) q.set('period', state.period);
  else if (state.period === 'custom' && state.range) { q.set('from', state.range.from); q.set('to', state.range.to); }
  else if (state.range?.from) q.set('month', state.range.from.slice(0, 7));
  if (includeOpenGame && state.openRowKey) {
    const row = state.rows.find(item => item.key === state.openRowKey);
    if (row) {
      q.set('game', gameId(row.game));
      if (row.day) q.set('release', row.day);
    }
  }
  return q;
}

function updateQuery(options) {
  const q = buildQuery(options);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
}

function matchesBase(row, { includeStatus = true, ignoreGenres = false } = {}) {
  const game = row.game;
  const search = normalizeSearch(state.search);
  if (search && !matchesSearch(game, search)) return false;
  if (state.platforms.size && !row.platformGroups.some(group => state.platforms.has(group))) return false;
  if (!ignoreGenres && state.genres.size) {
    const labels = new Set((game.genres || []).map(formatGenre));
    if (![...state.genres].some(genre => labels.has(genre))) return false;
  }
  if (state.company?.value) {
    const haystack = state.company.type === 'developer' ? game.developers : game.publishers;
    if (!(haystack || []).some(value => value === state.company.value)) return false;
  }
  if (state.series && !(game.series || []).includes(state.series)) return false;
  if (state.watchlistOnly && !isWatched(game)) return false;
  const precision = String(row.precision || (row.day ? 'day' : 'unknown')).toLowerCase();
  const precisionGroup = /^q[1-4]$|quarter|quarterly/.test(precision) ? 'quarter' : precision;
  if (!search && state.precision !== 'all' && precisionGroup !== state.precision) return false;
  if (includeStatus) {
    const today = todayLocal();
    if (state.status === 'upcoming' && row.day && row.day < today) return false;
    if (state.status === 'released' && (!row.day || row.day >= today)) return false;
  }
  return true;
}

function inActiveRange(row) {
  if (state.period === 'undated') return !row.day;
  if (!state.range) return true;
  if (!row.day) return state.precision !== 'all' && state.precision !== 'day';
  return row.day >= state.range.from && row.day <= state.range.to;
}

function filterRows() {
  const searching = Boolean(normalizeSearch(state.search));
  const filtered = searching
    ? state.rows.filter(row => matchesSearch(row.game, state.search))
    : state.rows.filter(row =>
        matchesBase(row, { includeStatus: !row.onlineResult })
        && (row.onlineResult || inActiveRange(row))
      );
  const rows = searching
    ? [...new Map(filtered.map(row => [gameId(row.game), row])).values()]
    : filtered;
  rows.sort((a, b) => {
    const ad = a.day || '';
    const bd = b.day || '';

    if (searching) {
      if (!ad && bd) return 1;
      if (ad && !bd) return -1;
      if (ad !== bd) return bd.localeCompare(ad);
      const relevance = searchRelevance(b.game, state.search) - searchRelevance(a.game, state.search);
      if (relevance) return relevance;
      return a.game.name.localeCompare(b.game.name, 'cs');
    }

    if (state.sort === 'name-desc') return b.game.name.localeCompare(a.game.name, 'cs') || ad.localeCompare(bd);
    if (state.sort === 'name-asc') return a.game.name.localeCompare(b.game.name, 'cs') || ad.localeCompare(bd);
    if (!ad && bd) return 1;
    if (ad && !bd) return -1;
    if (state.sort === 'date-desc') return bd.localeCompare(ad) || a.game.name.localeCompare(b.game.name, 'cs');
    return ad.localeCompare(bd) || a.game.name.localeCompare(b.game.name, 'cs');
  });
  return rows;
}

function renderPlatformFilters() {
  const available = new Set(state.rows.flatMap(row => row.platformGroups));
  const items = PLATFORM_GROUPS.filter(item => available.has(item.key));
  $('platform-filters').innerHTML = items.map(item => `
    <button class="chip chip--platform ${state.platforms.has(item.key) ? 'is-active' : ''}" type="button" data-platform="${escapeHtml(item.key)}" aria-pressed="${state.platforms.has(item.key)}">
      ${platformIcon(item.key, { className:'brand-icon--filter' })}<span>${escapeHtml(item.label)}</span>
    </button>`).join('');
  const sameAsSaved = state.savedPlatforms.size > 0 && state.savedPlatforms.size === state.platforms.size && [...state.savedPlatforms].every(value => state.platforms.has(value));
  $('platform-my').classList.toggle('is-active', sameAsSaved);
  $('platform-my').disabled = state.savedPlatforms.size === 0;
  $('platform-save').disabled = state.platforms.size === 0;
}

function genreCountRows() {
  return state.rows.filter(row => matchesBase(row, { ignoreGenres: true }) && inActiveRange(row));
}

function renderGenres() {
  const counts = new Map();
  const seen = new Map();
  for (const row of genreCountRows()) {
    for (const genre of [...new Set((row.game.genres || []).map(formatGenre).filter(Boolean))]) {
      if (!seen.has(genre)) seen.set(genre, new Set());
      seen.get(genre).add(gameId(row.game));
    }
  }
  for (const [genre, ids] of seen) counts.set(genre, ids.size);
  const available = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'));
  const featured = available.filter(([genre, count]) => count > 1 || state.genres.has(genre)).slice(0, MAX_GENRE_FILTERS);
  const selectedAvailable = available.filter(([genre]) => state.genres.has(genre));
  const selectedMissing = [...state.genres].filter(genre => !counts.has(genre)).map(genre => [genre, 0]);
  const genres = [...featured, ...selectedAvailable, ...selectedMissing]
    .filter((item, index, all) => all.findIndex(other => other[0] === item[0]) === index);
  $('genre-filters').innerHTML = genres.length
    ? genres.map(([genre, count]) => `<button type="button" class="genre-filter-chip ${state.genres.has(genre) ? 'is-active' : ''}" data-genre="${escapeHtml(genre)}" aria-pressed="${state.genres.has(genre)}"><span>${escapeHtml(genre)}</span><small>${formatter.format(count)}</small></button>`).join('')
    : '<span class="genre-empty">Žánry nejsou pro tento výběr dostupné.</span>';
  $('genre-clear').hidden = state.genres.size === 0;
}

function renderContextFilters() {
  const items = [];
  if (state.company?.value) items.push(`<button type="button" class="context-filter" data-clear-context="company">${state.company.type === 'developer' ? 'Vývojář' : 'Vydavatel'}: <strong>${escapeHtml(state.company.value)}</strong> ×</button>`);
  if (state.series) items.push(`<button type="button" class="context-filter" data-clear-context="series">Série: <strong>${escapeHtml(state.series)}</strong> ×</button>`);
  $('active-context-filters').innerHTML = items.join('');
  $('active-context-filters').hidden = items.length === 0;
}

function renderMonthSelectors() {
  const reference = state.range?.from || todayLocal();
  const [year, month] = reference.split('-').map(Number);
  $('month-filter').innerHTML = MONTHS.map((name, index) => `<option value="${index}" ${index === month - 1 ? 'selected' : ''}>${name}</option>`).join('');
  const days = state.rows.map(row => row.day).filter(Boolean).sort();
  const minYear = Math.min(year - 1, Number(days[0]?.slice(0,4) || year));
  const maxYear = Math.max(year + 2, Number(days.at(-1)?.slice(0,4) || year));
  $('year-filter').innerHTML = Array.from({length: maxYear - minYear + 1}, (_, i) => minYear + i).map(value => `<option value="${value}" ${value === year ? 'selected' : ''}>${value}</option>`).join('');
  document.querySelectorAll('[data-period]').forEach(button => button.classList.toggle('is-active', button.dataset.period === state.period));
}

function monthCounts() {
  const map = new Map();
  for (const row of state.rows) {
    if (!row.day || !matchesBase(row)) continue;
    const key = row.day.slice(0,7);
    if (!map.has(key)) map.set(key, { releases: 0, games: new Set() });
    const item = map.get(key);
    item.releases += 1;
    item.games.add(gameId(row.game));
  }
  return [...map.entries()].sort(([a],[b]) => a.localeCompare(b));
}

function renderMonthRail() {
  const counts = monthCounts();
  const active = state.range?.from?.slice(0,7) || '';
  $('month-rail').innerHTML = counts.map(([key, count]) => {
    const [year, month] = key.split('-').map(Number);
    return `<button class="month-tile ${active === key ? 'is-active' : ''}" type="button" data-month="${key}">
      <span>${MONTHS[month-1]} ${year}</span><strong>${formatter.format(count.games.size)} her</strong><small>${formatter.format(count.releases)} vydání</small>
    </button>`;
  }).join('');
}

function renderGames({ resetLimit = false } = {}) {
  if (resetLimit) state.limit = PAGE_SIZE;
  state.filtered = filterRows();
  const shown = state.filtered.slice(0, state.limit);
  $('games').dataset.view = state.view;
  $('games').innerHTML = shown.map(row => rowCard(row, isWatched(row.game))).join('');
  $('games').hidden = shown.length === 0;
  $('empty-state').hidden = state.filtered.length !== 0 || state.onlineSearchLoading;
  $('load-more-wrap').hidden = state.filtered.length <= shown.length;
  if (!state.filtered.length) $('games').innerHTML = '';
  if (state.onlineSearchLoading && !state.filtered.length) {
    $('empty-state').hidden = false;
    $('empty-state').querySelector('h2').textContent = 'Hledám ve všech zdrojích…';
    $('empty-state').querySelector('p').textContent = 'Kontroluji IGDB, Steam, Xbox, PlayStation a Nintendo.';
    $('empty-reset').hidden = true;
  } else {
    $('empty-state').querySelector('h2').textContent = 'Nic jsme nenašli';
    $('empty-state').querySelector('p').textContent = state.search
      ? 'Hra není v katalogu ani v připojených herních zdrojích.'
      : 'Zkus jinou platformu, žánr, období nebo název hry.';
    $('empty-reset').hidden = false;
  }
  updateSummary();
  renderMonthRail();
  renderGenres();
  renderContextFilters();
  updateQuery();
}

function notifyAvailableRows() {
  window.dispatchEvent(new CustomEvent('games:rows-updated', {
    detail: { rows: state.rows, searching: Boolean(normalizeSearch(state.search)) }
  }));
}

function makeOnlineRows(games) {
  return games.map((game, onlineOrder) => {
    const releases = game.releases || [];
    const first = releases[0] || {};
    const platforms = [...new Map(releases.flatMap(release => release.platforms || []).map(platform => [platform.name || platform.id, platform])).values()];
    return {
      key: `online:${game.id}`,
      game,
      day: first.day,
      timestamp: first.timestamp,
      platforms,
      platformGroups: [...new Set(platforms.map(item => item.group || platformGroup(item.name)))],
      window: first.window,
      precision: first.precision,
      regions: [...new Set(releases.flatMap(release => release.regions || []))],
      onlineResult: true,
      onlineOrder
    };
  });
}

async function refreshOnlineSearch(query) {
  const sequence = ++onlineSearchSequence;
  const value = String(query || '').trim();
  state.onlineRows = [];
  state.rows = state.catalogRows;
  if (value.length < 2) {
    state.onlineSearchLoading = false;
    renderGames({ resetLimit: true });
    notifyAvailableRows();
    return;
  }
  state.onlineSearchLoading = true;
  renderGames({ resetLimit: true });
  try {
    const games = await searchOnlineGames(value);
    if (sequence !== onlineSearchSequence || value !== state.search) return;
    state.onlineRows = makeOnlineRows(games);
    state.rows = [...state.catalogRows, ...state.onlineRows];
  } catch (error) {
    if (sequence === onlineSearchSequence) console.warn('Online hledání:', error);
  } finally {
    if (sequence === onlineSearchSequence) {
      state.onlineSearchLoading = false;
      renderGames({ resetLimit: true });
      notifyAvailableRows();
      const requested = findRequestedRow();
      if (requested && !state.openRowKey) openGame(requested.key, { updateUrl: false });
    }
  }
}

function statBaseRows() {
  return state.rows.filter(row => matchesBase(row, { includeStatus: false }));
}

function updateSummary() {
  const today = todayLocal();
  const next30End = addDays(today, 29);
  const now = new Date();
  const nextMonth = monthRange(now.getFullYear(), now.getMonth() + 1);
  const base = statBaseRows();
  const visibleGames = uniqueGameCount(state.filtered);
  $('stat-visible').textContent = formatter.format(visibleGames);
  $('stat-visible-label').textContent = visibleGames === 1 ? 'hra ve výběru' : 'her ve výběru';
  $('stat-30').textContent = formatter.format(uniqueGameCount(base.filter(row => row.day && row.day >= today && row.day <= next30End)));
  $('stat-next').textContent = formatter.format(uniqueGameCount(base.filter(row => row.day && row.day >= nextMonth.from && row.day <= nextMonth.to)));
  $('stat-watchlist').textContent = formatter.format(state.watchlist.size);

  const periodTitles = {
    week: 'Vydání tento týden',
    '30': 'Vydání během příštích 30 dní',
    '90': 'Vydání během příštích 90 dní',
    year: `Vydání v roce ${new Date().getFullYear()}`,
    undated: 'Hry bez přesného data',
    all: 'Všechna dostupná vydání'
  };
  const rangeTitle = state.search
    ? `Výsledky hledání „${state.search}“`
    : state.watchlistOnly
    ? 'Moje sledované hry'
    : state.period === 'all' && state.status === 'upcoming'
    ? 'Nadcházející hry'
    : periodTitles[state.period] || (state.period === 'custom' && state.range ? `${formatDate(state.range.from)} – ${formatDate(state.range.to)}` : state.range ? formatMonth(state.range.from) : periodTitles.all);
  $('range-title').textContent = rangeTitle;
  const parts = [`${formatter.format(visibleGames)} her`, `${formatter.format(state.filtered.length)} vydání`];
  if (state.platforms.size) parts.push([...state.platforms].map(value => value === 'Xbox Series' ? 'Xbox' : value).join(', '));
  if (state.genres.size) parts.push([...state.genres].join(' + '));
  if (state.search) parts.push(`„${state.search}“`);
  if (state.dataset?.generatedAt) parts.push(`data ${new Date(state.dataset.generatedAt).toLocaleString('cs-CZ')}`);
  $('result-summary').textContent = parts.join(' · ');
  $('watchlist-toggle').classList.toggle('is-active', state.watchlistOnly);
}

function setPeriod(kind) {
  state.period = kind;
  state.range = rangeForPeriod(kind);
  renderMonthSelectors();
  renderGames({resetLimit:true});
}

function selectMonth(year, monthIndex) {
  state.period = 'month';
  state.range = monthRange(Number(year), Number(monthIndex));
  renderMonthSelectors();
  renderGames({resetLimit:true});
}

function changeMonth(offset) {
  const reference = state.range?.from || todayLocal();
  const [year, month] = reference.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  selectMonth(date.getUTCFullYear(), date.getUTCMonth());
}

function resetFilters() {
  state.search = '';
  onlineSearchSequence += 1;
  state.onlineRows = [];
  state.rows = state.catalogRows;
  state.onlineSearchLoading = false;
  state.platforms.clear();
  state.genres.clear();
  state.company = null;
  state.series = '';
  state.status = 'upcoming';
  state.precision = 'all';
  state.sort = 'date-asc';
  state.watchlistOnly = false;
  setDefaultPeriod();
  $('search-input').value = '';
  $('status-filter').value = 'upcoming';
  $('precision-filter').value = 'all';
  $('sort-filter').value = 'date-asc';
  $('sort-filter').dispatchEvent(new Event('sortsync'));
  renderPlatformFilters();
  renderMonthSelectors();
  renderGames({resetLimit:true});
  notifyAvailableRows();
}

function toggleWatch(gameIdValue) {
  const id = String(gameIdValue);
  if (state.watchlist.has(id)) state.watchlist.delete(id); else state.watchlist.add(id);
  saveJsonSet(WATCH_KEY, state.watchlist);
  syncPushSubscription().catch(error => console.warn('Push sync:', error));
  renderGames();
  if ($('game-dialog').open) {
    const row = state.rows.find(item => item.key === state.openRowKey);
    if (row) renderGameDialog(row);
  }
}

function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'hra';
}

function calendarFeedUrl(mode = calendarFeedMode) {
  const url = new URL(CALENDAR_FEED_URL, location.origin);
  if (mode === 'watch') {
    if (state.watchlist.size) url.searchParams.set('ids', [...state.watchlist].slice(0, 500).join(','));
  } else {
    if (state.platforms.size) url.searchParams.set('platforms', [...state.platforms].join(','));
    if (state.genres.size) {
      const rawGenres = new Set();
      for (const row of state.rows) {
        for (const genre of row.game.genres || []) if (state.genres.has(formatGenre(genre))) rawGenres.add(genre);
      }
      if (rawGenres.size) url.searchParams.set('genres', [...rawGenres].join(','));
    }
    if (state.company?.type === 'developer') url.searchParams.set('developer', state.company.value);
    if (state.company?.type === 'publisher') url.searchParams.set('publisher', state.company.value);
    if (state.series) url.searchParams.set('series', state.series);
  }
  url.searchParams.set('status', 'upcoming');
  return url;
}

function setCalendarFeedMode(mode) {
  calendarFeedMode = mode === 'filters' ? 'filters' : 'watch';
  document.querySelectorAll('[data-calendar-feed]').forEach(button => {
    const active = button.dataset.calendarFeed === calendarFeedMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const url = calendarFeedUrl();
  const webcal = `webcal://${url.host}${url.pathname}${url.search}`;
  $('calendar-google').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  $('calendar-webcal').href = webcal;
}

function openCalendarDialog() {
  const count = state.watchlist.size;
  $('calendar-watch-count').textContent = `${formatter.format(count)} ${count === 1 ? 'sledovaná hra' : count > 1 && count < 5 ? 'sledované hry' : 'sledovaných her'}`;
  setCalendarFeedMode(count ? 'watch' : 'filters');
  if (!$('calendar-dialog').open) $('calendar-dialog').showModal();
}

function setMeta(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.setAttribute('content', value);
}

function updateSeoForGame(row) {
  const description = (row.game.summary || `${row.game.name} – ${row.day ? formatDate(row.day) : row.window || 'TBA'}`).replace(/\s+/g, ' ').trim().slice(0, 190);
  document.title = `${row.game.name} – Herní Kalendář`;
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', `${row.game.name} – Herní Kalendář`);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', location.href);
  if (row.game.cover) setMeta('meta[property="og:image"]', row.game.cover);
}

function restoreSeo() {
  document.title = DEFAULT_TITLE;
  setMeta('meta[name="description"]', DEFAULT_DESCRIPTION);
  setMeta('meta[property="og:title"]', DEFAULT_TITLE);
  setMeta('meta[property="og:description"]', DEFAULT_DESCRIPTION);
  setMeta('meta[property="og:url"]', `${location.origin}${location.pathname}`);
  setMeta('meta[property="og:image"]', `${location.origin}${location.pathname.replace(/[^/]*$/, '')}CaseyCZ.png`);
}

function renderGameDialog(row) {
  state.openRowKey = row.key;
  $('game-dialog').dataset.rowKey = row.key;
  $('dialog-content').innerHTML = gameDialogHtml(row, isWatched(row.game));
  updateQuery();
  updateSeoForGame(row);
}

async function openGame(rowKey, { updateUrl = true } = {}) {
  const row = state.rows.find(item => item.key === rowKey);
  if (!row) return;
  renderGameDialog(row);
  if (!$('game-dialog').open) $('game-dialog').showModal();
  if (!updateUrl) updateSeoForGame(row);

  try {
    const detail = await loadGameDetail(row.game);
    if (!detail || state.openRowKey !== rowKey || !$('game-dialog').open) return;
    Object.assign(row.game, detail);
    renderGameDialog(row);
  } catch (error) {
    console.warn('Detail hry:', error);
  }
}

function closeGameDialog() {
  if ($('game-dialog').open) $('game-dialog').close();
  state.openRowKey = '';
  updateQuery({ includeOpenGame: false });
  restoreSeo();
}

function findRequestedRow() {
  if (!state.requestedGameId) return null;
  const candidates = state.rows.filter(row => gameId(row.game) === String(state.requestedGameId) || row.game.slug === state.requestedGameId);
  if (!candidates.length) return null;
  if (state.requestedRelease) return candidates.find(row => row.day === state.requestedRelease) || candidates[0];
  return candidates[0];
}

function openCalendarMenu(row) {
  if (!row.day) { toast('Tato hra zatím nemá přesné datum pro kalendář.'); return; }
  const google = googleCalendarUrl(row);
  const choice = document.createElement('div');
  choice.className = 'toast';
  choice.innerHTML = `<strong>${escapeHtml(row.game.name)}</strong><div style="display:flex;gap:6px;margin-top:8px"><a class="store-link" href="${escapeHtml(google)}" target="_blank" rel="noopener noreferrer">Google</a><button class="store-link" type="button" data-ics-now>Apple / Outlook (.ics)</button></div>`;
  $('toast-region').appendChild(choice);
  choice.querySelector('[data-ics-now]').addEventListener('click', () => {
    downloadIcs([row], `${slugify(row.game.name)}-${row.day}.ics`);
    choice.remove();
  });
  setTimeout(() => choice.remove(), 9000);
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('toast-region').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function shareUrl(url, title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return true; } catch (error) { if (error?.name === 'AbortError') return false; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Odkaz byl zkopírován.');
    return true;
  } catch {
    prompt('Zkopíruj odkaz:', url);
    return true;
  }
}

async function shareCurrent() {
  updateQuery();
  await shareUrl(location.href, 'Herní Kalendář', 'Aktuální výběr her');
}

async function shareGame(row) {
  const q = buildQuery({ includeOpenGame: false });
  q.set('game', gameId(row.game));
  if (row.day) q.set('release', row.day);
  const url = `${location.origin}${location.pathname}?${q}`;
  await shareUrl(url, row.game.name, `${row.game.name} – ${row.day ? formatDate(row.day) : row.window || 'TBA'}`);
}

function setView(view) {
  state.view = view;
  localStorage.setItem(VIEW_KEY, view);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === view));
  renderGames();
}

function applyCompanyFilter(type, value) {
  state.company = { type, value };
  closeGameDialog();
  state.period = 'all';
  state.range = null;
  renderMonthSelectors();
  renderGames({resetLimit:true});
  window.scrollTo({top:0, behavior:'smooth'});
}

function applySeriesFilter(value) {
  state.series = value;
  closeGameDialog();
  state.period = 'all';
  state.range = null;
  renderMonthSelectors();
  renderGames({resetLimit:true});
  window.scrollTo({top:0, behavior:'smooth'});
}

function saveCurrentPlatforms() {
  if (!state.platforms.size) { toast('Nejdřív vyber platformy, které chceš uložit.'); return; }
  state.savedPlatforms = new Set(state.platforms);
  saveJsonSet(PLATFORM_PREF_KEY, state.savedPlatforms);
  renderPlatformFilters();
  toast(`Uloženo: ${[...state.savedPlatforms].join(', ')}.`);
}

function applyMyPlatforms() {
  if (!state.savedPlatforms.size) { toast('Zatím nemáš uložené žádné platformy.'); return; }
  state.platforms = new Set(state.savedPlatforms);
  renderPlatformFilters();
  renderGames({resetLimit:true});
}

function notificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

function urlBase64Bytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function syncPushSubscription() {
  if (!notificationSupported() || Notification.permission !== 'granted' || localStorage.getItem(NOTIFY_KEY) !== '1') return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const response = await fetch(PUSH_PUBLIC_KEY_URL, { headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error(`Push key HTTP ${response.status}`);
    const data = await response.json();
    if (!data.enabled || !data.publicKey) throw new Error('Push notifications are not configured');
    subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64Bytes(data.publicKey) });
  }
  const response = await fetch(PUSH_SUBSCRIBE_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify({ subscription:subscription.toJSON(), gameIds:[...state.watchlist] })
  });
  if (!response.ok) throw new Error(`Push subscription HTTP ${response.status}`);
  return true;
}

async function removePushSubscriptionFromServer() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await fetch(PUSH_SUBSCRIBE_URL, {
      method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ endpoint:subscription.endpoint })
    });
  } finally {
    await subscription.unsubscribe();
  }
}

function renderNotificationButton() {
  const button = $('notification-toggle');
  if (!button) return;
  if (!notificationSupported()) { button.hidden = true; return; }
  const enabled = localStorage.getItem(NOTIFY_KEY) === '1' && Notification.permission === 'granted';
  button.classList.toggle('is-active', enabled);
  button.title = enabled ? 'Upozornění na sledované hry jsou zapnutá' : 'Zapnout upozornění na sledované hry';
}

async function toggleNotifications() {
  if (!notificationSupported()) { toast('Tento prohlížeč upozornění nepodporuje.'); return; }
  if (localStorage.getItem(NOTIFY_KEY) === '1' && Notification.permission === 'granted') {
    await removePushSubscriptionFromServer().catch(error => console.warn('Push unsubscribe:', error));
    localStorage.setItem(NOTIFY_KEY, '0');
    renderNotificationButton();
    toast('Upozornění byla vypnuta.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { toast('Povolení pro upozornění nebylo uděleno.'); return; }
  localStorage.setItem(NOTIFY_KEY, '1');
  try {
    await syncPushSubscription();
    toast('Upozornění na pozadí jsou zapnutá.');
  } catch (error) {
    localStorage.setItem(NOTIFY_KEY, '0');
    console.warn('Push subscribe:', error);
    toast('Upozornění se nepodařilo zapnout. Zkuste to znovu.');
  }
  renderNotificationButton();
}

async function maybeNotifyUpcoming(force = false) {
  if (!notificationSupported() || Notification.permission !== 'granted' || localStorage.getItem(NOTIFY_KEY) !== '1' || !state.rows.length) return;
  const today = todayLocal();
  if (!force && localStorage.getItem(NOTIFY_LAST_KEY) === today) return;
  const end = addDays(today, 7);
  const upcoming = state.rows.filter(row => row.day && row.day >= today && row.day <= end && isWatched(row.game));
  if (!upcoming.length) {
    if (force) toast('Žádná sledovaná hra nevychází během příštích 7 dní.');
    localStorage.setItem(NOTIFY_LAST_KEY, today);
    return;
  }
  const unique = [];
  const ids = new Set();
  for (const row of upcoming) if (!ids.has(gameId(row.game))) { ids.add(gameId(row.game)); unique.push(row); }
  const first = unique[0];
  const body = unique.slice(0,3).map(row => `${row.game.name} – ${formatDate(row.day)}`).join('\n') + (unique.length > 3 ? `\n+ ${unique.length - 3} další` : '');
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('Herní Kalendář – blíží se vydání', {
      body,
      icon: './CaseyCZ.png',
      badge: './CaseyCZ.png',
      tag: `game-release-${today}`,
      data: { url: `./?game=${encodeURIComponent(gameId(first.game))}&release=${encodeURIComponent(first.day)}` }
    });
    localStorage.setItem(NOTIFY_LAST_KEY, today);
  } catch (error) {
    console.warn('Notification:', error);
  }
}

function bindEvents() {
  $('search-toggle').addEventListener('click', () => {
    const open = $('search-popover').hidden;
    $('search-popover').hidden = !open;
    $('search-toggle').setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(() => $('search-input').focus());
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      $('search-popover').hidden = false;
      $('search-toggle').setAttribute('aria-expanded','true');
      $('search-input').focus();
    }
    if (event.key === 'Escape' && !$('search-popover').hidden) {
      $('search-popover').hidden = true;
      $('search-toggle').setAttribute('aria-expanded','false');
    }
  });

  $('search-input').addEventListener('input', debounce(event => {
    const wasSearching = Boolean(normalizeSearch(state.search));
    state.search = event.target.value.trim();
    const isSearching = Boolean(normalizeSearch(state.search));

    if (!wasSearching && isSearching) {
      state.sort = 'date-desc';
      $('sort-filter').value = 'date-desc';
      $('sort-filter').dispatchEvent(new Event('sortsync'));
    } else if (wasSearching && !isSearching) {
      state.sort = 'date-asc';
      $('sort-filter').value = 'date-asc';
      $('sort-filter').dispatchEvent(new Event('sortsync'));
    }

    refreshOnlineSearch(state.search);
  }, 350));
  $('platform-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-platform]');
    if (!button) return;
    const key = button.dataset.platform;
    if (state.platforms.has(key)) state.platforms.delete(key); else state.platforms.add(key);
    renderPlatformFilters();
    renderGames({resetLimit:true});
  });
  $('platform-save').addEventListener('click', saveCurrentPlatforms);
  $('platform-my').addEventListener('click', applyMyPlatforms);
  $('genre-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-genre]');
    if (!button) return;
    const genre = button.dataset.genre;
    if (state.genres.has(genre)) state.genres.delete(genre); else state.genres.add(genre);
    renderGames({resetLimit:true});
  });
  $('genre-clear').addEventListener('click', () => { state.genres.clear(); renderGames({resetLimit:true}); });
  $('active-context-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-clear-context]');
    if (!button) return;
    if (button.dataset.clearContext === 'company') state.company = null;
    if (button.dataset.clearContext === 'series') state.series = '';
    renderGames({resetLimit:true});
  });
  $('status-filter').addEventListener('change', event => { state.status = event.target.value; renderGames({resetLimit:true}); });
  $('precision-filter').addEventListener('change', event => { state.precision = event.target.value; renderGames({resetLimit:true}); });
  $('sort-filter').addEventListener('change', event => { state.sort = event.target.value; renderGames({resetLimit:true}); });
  document.querySelector('.period-control').addEventListener('click', event => {
    const button = event.target.closest('[data-period]');
    if (button) setPeriod(button.dataset.period);
  });
  $('month-filter').addEventListener('change', () => selectMonth($('year-filter').value, $('month-filter').value));
  $('year-filter').addEventListener('change', () => selectMonth($('year-filter').value, $('month-filter').value));
  $('prev-month').addEventListener('click', () => changeMonth(-1));
  $('next-month').addEventListener('click', () => changeMonth(1));
  $('month-rail').addEventListener('click', event => {
    const button = event.target.closest('[data-month]');
    if (!button) return;
    const [year, month] = button.dataset.month.split('-').map(Number);
    selectMonth(year, month - 1);
    window.scrollTo({top: 0, behavior:'smooth'});
  });
  $('reset-filters').addEventListener('click', resetFilters);
  $('empty-reset').addEventListener('click', resetFilters);
  $('watchlist-toggle').addEventListener('click', () => { state.watchlistOnly = !state.watchlistOnly; renderGames({resetLimit:true}); });
  document.querySelectorAll('[data-stat-jump]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.statJump;
    if (action === '30') {
      state.status = 'upcoming';
      $('status-filter').value = 'upcoming';
      setPeriod('30');
    } else if (action === 'next') setPeriod('next');
    else $('games').scrollIntoView({behavior:'smooth', block:'start'});
  }));
  $('share-button').addEventListener('click', shareCurrent);
  $('notification-toggle').addEventListener('click', toggleNotifications);
  $('calendar-all').addEventListener('click', openCalendarDialog);
  $('calendar-dialog-close').addEventListener('click', () => $('calendar-dialog').close());
  $('calendar-dialog').addEventListener('click', event => {
    if (event.target === $('calendar-dialog')) $('calendar-dialog').close();
    const choice = event.target.closest('[data-calendar-feed]');
    if (choice) setCalendarFeedMode(choice.dataset.calendarFeed);
  });
  $('calendar-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrl().href);
      toast('Adresa živého kalendáře byla zkopírována.');
    } catch {
      toast('Adresu se nepodařilo zkopírovat.');
    }
  });
  $('calendar-download').addEventListener('click', () => {
    const dated = state.filtered.filter(row => row.day);
    if (!downloadIcs(dated, `herni-kalendar-${state.range?.from || 'vse'}.ics`)) toast('Aktuální výběr nemá žádné přesné datum.');
  });
  document.querySelector('.view-toggle').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });
  $('load-more').addEventListener('click', () => { state.limit += PAGE_SIZE; renderGames(); });

  $('games').addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) event.target.remove();
  }, true);
  $('games').addEventListener('click', event => {
    const open = event.target.closest('[data-open-game]');
    if (open) { openGame(open.dataset.openGame); return; }
    const watch = event.target.closest('[data-watch]');
    if (watch) { toggleWatch(watch.dataset.watch); return; }
    const calendar = event.target.closest('[data-calendar]');
    if (calendar) {
      const row = state.rows.find(item => item.key === calendar.dataset.calendar);
      if (row) openCalendarMenu(row);
    }
  });

  $('dialog-close').addEventListener('click', closeGameDialog);
  $('game-dialog').addEventListener('close', () => {
    if (state.openRowKey) {
      state.openRowKey = '';
      updateQuery({ includeOpenGame: false });
      restoreSeo();
    }
  });
  $('game-dialog').addEventListener('click', event => {
    if (event.target === $('game-dialog')) { closeGameDialog(); return; }
    const watch = event.target.closest('[data-dialog-watch]');
    if (watch) { toggleWatch(watch.dataset.dialogWatch); return; }
    const calendar = event.target.closest('[data-dialog-calendar]');
    if (calendar) {
      const row = state.rows.find(item => item.key === calendar.dataset.dialogCalendar);
      if (row) openCalendarMenu(row);
      return;
    }
    const share = event.target.closest('[data-dialog-share]');
    if (share) {
      const row = state.rows.find(item => item.key === share.dataset.dialogShare);
      if (row) shareGame(row);
      return;
    }
    const company = event.target.closest('[data-filter-company]');
    if (company) { applyCompanyFilter(company.dataset.filterCompany, company.dataset.filterValue); return; }
    const series = event.target.closest('[data-filter-series]');
    if (series) { applySeriesFilter(series.dataset.filterSeries); return; }
    const genre = event.target.closest('[data-dialog-genre]');
    if (genre) {
      state.genres = new Set([genre.dataset.dialogGenre]);
      closeGameDialog();
      renderGames({resetLimit:true});
      window.scrollTo({top:0, behavior:'smooth'});
      return;
    }
    const gallery = event.target.closest('[data-gallery-image]');
    if (gallery) {
      $('image-dialog-img').src = gallery.dataset.galleryImage;
      $('image-dialog').showModal();
    }
  });
  $('image-dialog-close').addEventListener('click', () => $('image-dialog').close());
  $('image-dialog').addEventListener('click', event => { if (event.target === $('image-dialog')) $('image-dialog').close(); });
}

function hydrateControls() {
  $('search-input').value = state.search;
  $('status-filter').value = state.status;
  $('precision-filter').value = state.precision;
  $('sort-filter').value = state.sort;
  $('sort-filter').dispatchEvent(new Event('sortsync'));
  renderPlatformFilters();
  renderGenres();
  renderMonthSelectors();
  renderContextFilters();
  renderNotificationButton();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === state.view));
}

function setDataset(dataset, { quiet = false, first = false } = {}) {
  state.dataset = dataset;
  state.catalogRows = flattenReleases(dataset);
  state.rows = [...state.catalogRows, ...state.onlineRows];
  if (first && !state.queryHadPlatforms && state.savedPlatforms.size) state.platforms = new Set(state.savedPlatforms);
  hydrateControls();
  renderGames({resetLimit:true});
  $('skeleton-grid').hidden = true;
  $('games').hidden = state.filtered.length === 0;
  if (!quiet) toast(`Načteno ${formatter.format(uniqueGameCount(state.rows))} her / ${formatter.format(state.rows.length)} vydání.`);
  const requested = findRequestedRow();
  if (requested && !state.openRowKey) openGame(requested.key, { updateUrl: false });
  if (first && state.search) refreshOnlineSearch(state.search);
}

async function init() {
  setDefaultPeriod();
  parseQuery();
  bindEvents();
  restoreSeo();
  try {
    const result = await loadGameData({ onRevalidated: fresh => setDataset(fresh, {quiet:true}) });
    setDataset(result.dataset, {quiet:true, first:true});
    if (result.stale) toast('Síť není dostupná – zobrazuji poslední uložená data.');
  } catch (error) {
    console.error(error);
    $('skeleton-grid').hidden = true;
    $('empty-state').hidden = false;
    $('empty-state').querySelector('h2').textContent = 'Data se nepodařilo načíst';
    $('empty-state').querySelector('p').textContent = 'Zkontroluj games.json nebo připojení a obnov stránku.';
  }

  setInterval(() => { if (state.dataset) renderGames(); }, 60_000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(async () => {
      renderNotificationButton();
      if (localStorage.getItem(NOTIFY_KEY) === '1' && Notification.permission === 'granted') await syncPushSubscription();
    }).catch(error => console.warn('Service worker:', error));
  }
}

init();
