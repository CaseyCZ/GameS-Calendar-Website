import {
  PLATFORM_GROUPS,
  addDays,
  flattenReleases,
  loadGameData,
  monthRange,
  todayLocal
} from './data.js';
import { downloadIcs, googleCalendarUrl } from './calendar.js';
import { MONTHS, escapeHtml, formatDate, formatGenre, formatMonth, formatter, gameDialogHtml, platformIcon, rowCard } from './ui.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 72;
const WATCH_KEY = 'games-calendar-watchlist-v2';
const VIEW_KEY = 'games-calendar-view-v2';

function debounce(fn, wait = 180) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

function readWatchlist() {
  try {
    const value = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch { return new Set(); }
}

function saveWatchlist() {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify([...state.watchlist])); } catch {}
}

const gameId = game => String(game.id);
const isWatched = game => state.watchlist.has(gameId(game));

const state = {
  dataset: null,
  rows: [],
  filtered: [],
  search: '',
  platforms: new Set(),
  genre: '',
  status: 'upcoming',
  period: 'month',
  range: null,
  sort: 'date-asc',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  watchlistOnly: false,
  watchlist: readWatchlist(),
  limit: PAGE_SIZE
};

function setDefaultPeriod() {
  const now = new Date();
  state.period = 'month';
  state.range = monthRange(now.getFullYear(), now.getMonth());
}

function parseQuery() {
  const query = new URLSearchParams(location.search);
  if (query.has('q')) state.search = query.get('q') || '';
  if (query.has('platforms')) {
    state.platforms = new Set(query.get('platforms').split(',').filter(Boolean));
  }
  if (query.has('genre')) state.genre = query.get('genre') || '';
  if (['upcoming','released','all'].includes(query.get('status'))) state.status = query.get('status');
  if (['date-asc','date-desc','rating-desc','name-asc'].includes(query.get('sort'))) state.sort = query.get('sort');
  if (['grid','compact'].includes(query.get('view'))) state.view = query.get('view');
  const from = query.get('from');
  const to = query.get('to');
  const month = query.get('month');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to) {
    state.period = 'custom'; state.range = {from, to};
  } else if (/^\d{4}-\d{2}$/.test(month || '')) {
    const [year, m] = month.split('-').map(Number);
    state.period = 'month';
    state.range = monthRange(year, m - 1);
  } else if (query.get('period') === 'all') {
    state.period = 'all'; state.range = null;
  } else if (query.get('period') === 'next') {
    const now = new Date();
    state.period = 'next'; state.range = monthRange(now.getFullYear(), now.getMonth() + 1);
  }
}

function updateQuery() {
  const q = new URLSearchParams();
  if (state.search) q.set('q', state.search);
  if (state.platforms.size) q.set('platforms', [...state.platforms].join(','));
  if (state.genre) q.set('genre', state.genre);
  if (state.status !== 'upcoming') q.set('status', state.status);
  if (state.sort !== 'date-asc') q.set('sort', state.sort);
  if (state.view !== 'grid') q.set('view', state.view);
  if (state.period === 'all') q.set('period', 'all');
  else if (state.period === 'next') q.set('period', 'next');
  else if (state.period === 'custom' && state.range) { q.set('from', state.range.from); q.set('to', state.range.to); }
  else if (state.range?.from) q.set('month', state.range.from.slice(0, 7));
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
}

function matchesBase(row, { includeStatus = true } = {}) {
  const game = row.game;
  const search = state.search.trim().toLocaleLowerCase('cs');
  if (search && !game.name.toLocaleLowerCase('cs').includes(search)) return false;
  if (state.platforms.size && !row.platformGroups.some(group => state.platforms.has(group))) return false;
  if (state.genre && !(game.genres || []).some(genre => formatGenre(genre) === state.genre)) return false;
  if (state.watchlistOnly && !isWatched(game)) return false;
  if (includeStatus) {
    const today = todayLocal();
    if (state.status === 'upcoming' && row.day < today) return false;
    if (state.status === 'released' && row.day >= today) return false;
  }
  return true;
}

function filterRows() {
  const rows = state.rows.filter(row => {
    if (!matchesBase(row)) return false;
    if (state.range && (row.day < state.range.from || row.day > state.range.to)) return false;
    return true;
  });

  rows.sort((a, b) => {
    if (state.sort === 'date-desc') return b.day.localeCompare(a.day) || a.game.name.localeCompare(b.game.name, 'cs');
    if (state.sort === 'rating-desc') return (b.game.rating || 0) - (a.game.rating || 0) || a.day.localeCompare(b.day);
    if (state.sort === 'name-asc') return a.game.name.localeCompare(b.game.name, 'cs') || a.day.localeCompare(b.day);
    return a.day.localeCompare(b.day) || a.game.name.localeCompare(b.game.name, 'cs');
  });
  return rows;
}

function renderPlatformFilters() {
  const available = new Set(state.rows.flatMap(row => row.platformGroups));
  const items = PLATFORM_GROUPS.filter(item => available.has(item.key));
  $('platform-filters').innerHTML = items.map(item => `
    <button class="chip chip--platform ${state.platforms.has(item.key) ? 'is-active' : ''}" type="button" data-platform="${escapeHtml(item.key)}" aria-pressed="${state.platforms.has(item.key)}">
      ${platformIcon(item.key)}<span>${escapeHtml(item.label)}</span>
    </button>`).join('');
}

function renderGenres() {
  const genres = [...new Set(state.dataset.games.flatMap(game => (game.genres || []).map(formatGenre)))].filter(Boolean).sort((a,b) => a.localeCompare(b,'cs'));
  $('genre-filter').innerHTML = '<option value="">Všechny žánry</option>' + genres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
  $('genre-filter').value = genres.includes(state.genre) ? state.genre : '';
  if (state.genre && !genres.includes(state.genre)) state.genre = '';
}

function renderMonthSelectors() {
  const reference = state.range?.from || todayLocal();
  const [year, month] = reference.split('-').map(Number);
  $('month-filter').innerHTML = MONTHS.map((name, index) => `<option value="${index}" ${index === month - 1 ? 'selected' : ''}>${name}</option>`).join('');
  const days = state.rows.map(row => row.day).sort();
  const minYear = Math.min(year - 1, Number(days[0]?.slice(0,4) || year));
  const maxYear = Math.max(year + 2, Number(days.at(-1)?.slice(0,4) || year));
  $('year-filter').innerHTML = Array.from({length: maxYear - minYear + 1}, (_, i) => minYear + i).map(value => `<option value="${value}" ${value === year ? 'selected' : ''}>${value}</option>`).join('');
  document.querySelectorAll('[data-period]').forEach(button => button.classList.toggle('is-active', button.dataset.period === state.period));
}

function monthCounts() {
  const counts = new Map();
  for (const row of state.rows) {
    if (!matchesBase(row)) continue;
    const key = row.day.slice(0,7);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort(([a],[b]) => a.localeCompare(b));
}

function renderMonthRail() {
  const counts = monthCounts();
  const active = state.range?.from.slice(0,7) || '';
  $('month-rail').innerHTML = counts.map(([key, count]) => {
    const [year, month] = key.split('-').map(Number);
    return `<button class="month-tile ${active === key ? 'is-active' : ''}" type="button" data-month="${key}">
      <span>${MONTHS[month-1]} ${year}</span><strong>${formatter.format(count)}</strong>
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
  $('empty-state').hidden = state.filtered.length !== 0;
  $('load-more-wrap').hidden = state.filtered.length <= shown.length;
  if (!state.filtered.length) $('games').innerHTML = '';
  updateSummary();
  renderMonthRail();
  updateQuery();
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
  $('stat-visible').textContent = formatter.format(state.filtered.length);
  $('stat-30').textContent = formatter.format(base.filter(row => row.day >= today && row.day <= next30End).length);
  $('stat-next').textContent = formatter.format(base.filter(row => row.day >= nextMonth.from && row.day <= nextMonth.to).length);
  $('stat-watchlist').textContent = formatter.format(state.watchlist.size);

  const rangeTitle = state.watchlistOnly ? 'Moje sledované hry' : state.period === 'custom' && state.range ? `${formatDate(state.range.from)} – ${formatDate(state.range.to)}` : state.range ? formatMonth(state.range.from) : 'Všechna dostupná vydání';
  $('range-title').textContent = rangeTitle;
  const parts = [`${formatter.format(state.filtered.length)} vydání`];
  if (state.platforms.size) parts.push([...state.platforms].join(', '));
  if (state.genre) parts.push(state.genre);
  if (state.search) parts.push(`„${state.search}“`);
  if (state.dataset.generatedAt) parts.push(`data ${new Date(state.dataset.generatedAt).toLocaleString('cs-CZ')}`);
  $('result-summary').textContent = parts.join(' · ');
  $('watchlist-toggle').classList.toggle('is-active', state.watchlistOnly);
}

function setPeriod(kind) {
  const now = new Date();
  state.period = kind;
  if (kind === 'all') state.range = null;
  else if (kind === 'next') state.range = monthRange(now.getFullYear(), now.getMonth() + 1);
  else state.range = monthRange(now.getFullYear(), now.getMonth());
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
  state.platforms.clear();
  state.genre = '';
  state.status = 'upcoming';
  state.sort = 'date-asc';
  state.watchlistOnly = false;
  setDefaultPeriod();
  $('search-input').value = '';
  $('genre-filter').value = '';
  $('status-filter').value = 'upcoming';
  $('sort-filter').value = 'date-asc';
  renderPlatformFilters();
  renderMonthSelectors();
  renderGames({resetLimit:true});
}

function toggleWatch(gameIdValue) {
  const id = String(gameIdValue);
  if (state.watchlist.has(id)) state.watchlist.delete(id); else state.watchlist.add(id);
  saveWatchlist();
  renderGames();
  if ($('game-dialog').open) {
    const rowKey = $('game-dialog').dataset.rowKey;
    const row = state.rows.find(item => item.key === rowKey);
    if (row) renderGameDialog(row);
  }
}

function renderGameDialog(row) {
  $('game-dialog').dataset.rowKey = row.key;
  $('dialog-content').innerHTML = gameDialogHtml(row, isWatched(row.game));
}

function openGame(rowKey) {
  const row = state.rows.find(item => item.key === rowKey);
  if (!row) return;
  renderGameDialog(row);
  $('game-dialog').showModal();
}

function openCalendarMenu(row) {
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

function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'hra';
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('toast-region').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function shareCurrent() {
  updateQuery();
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Odkaz na aktuální výběr byl zkopírován.');
  } catch {
    prompt('Zkopíruj odkaz:', location.href);
  }
}

function setView(view) {
  state.view = view;
  localStorage.setItem(VIEW_KEY, view);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === view));
  renderGames();
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
    state.search = event.target.value.trim();
    renderGames({resetLimit:true});
  }));
  $('platform-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-platform]');
    if (!button) return;
    const key = button.dataset.platform;
    if (state.platforms.has(key)) state.platforms.delete(key); else state.platforms.add(key);
    renderPlatformFilters();
    renderGames({resetLimit:true});
  });
  $('genre-filter').addEventListener('change', event => { state.genre = event.target.value; renderGames({resetLimit:true}); });
  $('status-filter').addEventListener('change', event => { state.status = event.target.value; renderGames({resetLimit:true}); });
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
      state.status = 'upcoming'; state.period = 'custom'; state.range = {from:todayLocal(), to:addDays(todayLocal(),29)};
      $('status-filter').value = 'upcoming'; renderMonthSelectors(); renderGames({resetLimit:true});
    } else if (action === 'next') setPeriod('next');
    else document.getElementById('games').scrollIntoView({behavior:'smooth', block:'start'});
  }));
  $('share-button').addEventListener('click', shareCurrent);
  $('calendar-all').addEventListener('click', () => {
    if (!downloadIcs(state.filtered, `herni-kalendar-${state.range?.from || 'vse'}.ics`)) toast('Aktuální výběr je prázdný.');
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

  $('dialog-close').addEventListener('click', () => $('game-dialog').close());
  $('game-dialog').addEventListener('click', event => {
    if (event.target === $('game-dialog')) { $('game-dialog').close(); return; }
    const watch = event.target.closest('[data-dialog-watch]');
    if (watch) { toggleWatch(watch.dataset.dialogWatch); return; }
    const calendar = event.target.closest('[data-dialog-calendar]');
    if (calendar) {
      const row = state.rows.find(item => item.key === calendar.dataset.dialogCalendar);
      if (row) openCalendarMenu(row);
      return;
    }
    const trailer = event.target.closest('[data-trailer]');
    if (trailer) {
      const id = trailer.dataset.trailer.replace(/[^a-zA-Z0-9_-]/g,'');
      $('trailer-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      $('trailer-dialog').showModal();
    }
  });
  $('trailer-close').addEventListener('click', () => $('trailer-dialog').close());
  $('trailer-dialog').addEventListener('close', () => { $('trailer-frame').innerHTML = ''; });
  $('trailer-dialog').addEventListener('click', event => { if (event.target === $('trailer-dialog')) $('trailer-dialog').close(); });
}

function hydrateControls() {
  $('search-input').value = state.search;
  $('status-filter').value = state.status;
  $('sort-filter').value = state.sort;
  renderGenres();
  renderPlatformFilters();
  renderMonthSelectors();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === state.view));
}

function setDataset(dataset, { quiet = false } = {}) {
  state.dataset = dataset;
  state.rows = flattenReleases(dataset);
  hydrateControls();
  renderGames({resetLimit:true});
  $('skeleton-grid').hidden = true;
  $('games').hidden = state.filtered.length === 0;
  if (!quiet) toast(`Načteno ${formatter.format(state.rows.length)} vydání.`);
}

async function init() {
  setDefaultPeriod();
  parseQuery();
  bindEvents();
  try {
    const result = await loadGameData({ onRevalidated: fresh => setDataset(fresh, {quiet:true}) });
    setDataset(result.dataset, {quiet:true});
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
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error));
  }
}

init();
