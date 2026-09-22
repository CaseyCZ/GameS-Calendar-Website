import { addDays, flattenReleases, loadGameData, monthRange, todayLocal } from './js/data.js';
import { formatGenre, formatter, rowCard } from './js/ui.js';
import { matchesSearch, normalizeSearch, searchRelevance } from './js/search.js';

const $ = id => document.getElementById(id);
const TRAIT_KEY = 'games-calendar-trait-filters-v1';
const BADGE_PREF_KEY = 'games-calendar-badge-prefs-v1';
const GESTURE_KEY = 'games-calendar-detail-gestures-v1';
const PAGE_SIZE = 72;

const TRAIT_GROUPS = [
  {
    key: 'scale',
    label: 'Kategorie',
    partition: true,
    items: [
      ['aaa', 'AAA'],
      ['indie', 'Indie'],
      ['small', 'Menší titul'],
      ['scale_unknown', 'Nezařazeno']
    ]
  },
  {
    key: 'access',
    label: 'Stav vydání',
    partition: true,
    items: [
      ['early', 'Early Access'],
      ['regular', 'Běžné vydání']
    ]
  },
  {
    key: 'type',
    label: 'Typ hry',
    partition: true,
    items: [
      ['full', 'Plná hra'],
      ['dlc', 'DLC'],
      ['expansion', 'Rozšíření'],
      ['remake', 'Remake'],
      ['remaster', 'Remaster'],
      ['demo', 'Demo'],
      ['mod', 'Mod'],
      ['type_unknown', 'Nezařazeno']
    ]
  },
  {
    key: 'services',
    label: 'Předplatné',
    partition: false,
    items: [
      ['gamepass', 'Game Pass'],
      ['cloud', 'Cloud Gaming'],
      ['psplus', 'PS Plus'],
      ['gfn', 'GeForce NOW'],
      ['no_service', 'Bez předplatného']
    ]
  },
  {
    key: 'media',
    label: 'Média a data',
    partition: false,
    items: [
      ['trailer', 'Trailer'],
      ['screenshots', 'Screenshoty'],
      ['rating', 'S hodnocením'],
      ['description', 'S popisem']
    ]
  }
];

const TRAIT_LABELS = new Map(TRAIT_GROUPS.flatMap(group => group.items));
const TRAIT_GROUP_BY_ITEM = new Map(TRAIT_GROUPS.flatMap(group => group.items.map(([key]) => [key, group.key])));
const DEFAULT_BADGES = {
  release: true,
  scale: true,
  type: true,
  fullType: false,
  early: true,
  services: true,
  rating: true
};

let dataset = null;
let rows = [];
let rowMap = new Map();
let rawGameMap = new Map();
let traits = new Set([...readSet(TRAIT_KEY)].filter(item => TRAIT_LABELS.has(item)));
let badgePrefs = readBadgePrefs();
let advancedLimit = PAGE_SIZE;
let wasFiltering = false;
let ignoreGameMutation = false;
let touchStart = null;

function readSet(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

function readBadgePrefs() {
  try {
    return { ...DEFAULT_BADGES, ...(JSON.parse(localStorage.getItem(BADGE_PREF_KEY) || '{}') || {}) };
  } catch {
    return { ...DEFAULT_BADGES };
  }
}

function saveBadgePrefs() {
  try { localStorage.setItem(BADGE_PREF_KEY, JSON.stringify(badgePrefs)); } catch {}
}

function gesturesEnabled() {
  return localStorage.getItem(GESTURE_KEY) !== '0';
}

function ensureStyles() {
  if (document.querySelector('link[data-advanced-features]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'advanced-features.css';
  link.dataset.advancedFeatures = '1';
  document.head.appendChild(link);
}

function rawGame(game) {
  return rawGameMap.get(String(game?.id)) || {};
}

function contentType(game) {
  const raw = String(game.contentType || rawGame(game).contentType || '').trim().toLowerCase();
  const text = normalizeSearch(`${game.name || ''} ${game.summary || ''}`);

  if (/\bremaster(ed)?\b/.test(text)) return 'Remaster';
  if (/\bremake\b/.test(text)) return 'Remake';
  if (/\bexpansion\b|expansion pack|rozsireni/.test(text)) return 'Rozšíření';
  if (/\bdlc\b|downloadable content/.test(text)) return 'DLC';
  if (/\bdemo\b/.test(text)) return 'Demo';

  if (['dlc','downloadable content','dlc / addon','pack / addon'].includes(raw)) return 'DLC';
  if (['expansion','expansion pack','rozšíření','standalone expansion','expanded game'].includes(raw)) return 'Rozšíření';
  if (['remake'].includes(raw)) return 'Remake';
  if (['remaster','remastered'].includes(raw)) return 'Remaster';
  if (['demo'].includes(raw)) return 'Demo';
  if (['mod'].includes(raw)) return 'Mod';
  if (['game','full game','plná hra','full','main game','port'].includes(raw)) return 'Plná hra';
  return game.contentType || rawGame(game).contentType || '';
}

function gameTraits(game) {
  const result = new Set();
  const raw = rawGame(game);
  const scale = normalizeSearch(game.scale || raw.scale || '');
  let hasScale = false;
  if (scale === 'aaa' || scale.includes('triple a')) { result.add('aaa'); hasScale = true; }
  else if (scale.includes('indie')) { result.add('indie'); hasScale = true; }
  else if (scale.includes('mensi') || scale.includes('small')) { result.add('small'); hasScale = true; }
  if (!hasScale) result.add('scale_unknown');

  const early = Boolean(game.earlyAccess || raw.earlyAccess);
  result.add(early ? 'early' : 'regular');

  const type = normalizeSearch(contentType(game));
  let hasType = false;
  if (type.includes('plna hra') || type === 'game' || type === 'full game') { result.add('full'); hasType = true; }
  else if (type === 'dlc' || type.includes('downloadable')) { result.add('dlc'); hasType = true; }
  else if (type.includes('rozsireni') || type.includes('expansion')) { result.add('expansion'); hasType = true; }
  else if (type.includes('remake')) { result.add('remake'); hasType = true; }
  else if (type.includes('remaster')) { result.add('remaster'); hasType = true; }
  else if (type.includes('demo')) { result.add('demo'); hasType = true; }
  else if (type === 'mod' || type.includes('modifikace')) { result.add('mod'); hasType = true; }
  if (!hasType) result.add('type_unknown');

  const subs = { ...(game.subscriptions || {}), ...(raw.subscriptions || {}) };
  const hasGamePass = Boolean(subs.gamePass || subs.gamePassConsole || subs.gamePassPc || subs.cloudGaming);
  const hasPsPlus = Boolean(subs.psPlus);
  const hasGfn = Boolean(subs.geforceNow);
  if (hasGamePass) result.add('gamepass');
  if (subs.cloudGaming) result.add('cloud');
  if (hasPsPlus) result.add('psplus');
  if (hasGfn) result.add('gfn');
  if (!hasGamePass && !hasPsPlus && !hasGfn) result.add('no_service');

  if (game.trailerId || game.trailerUrl || raw.trailerId || raw.trailerUrl) result.add('trailer');
  const shots = game.hasScreenshots || raw.hasScreenshots || game.screenshots?.length || raw.screenshots?.length;
  if (shots) result.add('screenshots');
  if (Number(game.rating || raw.rating || 0) > 0) result.add('rating');
  if (game.hasDescription || raw.hasDescription || String(game.summary || game.storyline || raw.summary || raw.storyline || '').trim()) result.add('description');
  return result;
}

function selectedTraitsByGroup() {
  const selected = new Map();
  for (const trait of traits) {
    const group = TRAIT_GROUP_BY_ITEM.get(trait) || trait;
    if (!selected.has(group)) selected.set(group, []);
    selected.get(group).push(trait);
  }
  return selected;
}

function matchesSelectedTraits(game) {
  if (!traits.size) return true;
  const available = gameTraits(game);
  for (const keys of selectedTraitsByGroup().values()) {
    if (!keys.some(key => available.has(key))) return false;
  }
  return true;
}

function readBaseState() {
  const query = new URLSearchParams(location.search);
  const platforms = new Set([...document.querySelectorAll('#platform-filters [data-platform].is-active')].map(node => node.dataset.platform));
  const genres = new Set([...document.querySelectorAll('#genre-filters [data-genre].is-active')].map(node => node.dataset.genre));
  const search = $('search-input')?.value?.trim() || '';
  const status = $('status-filter')?.value || 'upcoming';
  const precision = $('precision-filter')?.value || 'all';
  const sort = $('sort-filter')?.value || 'date-asc';
  const watchlistOnly = $('watchlist-toggle')?.classList.contains('is-active') || false;
  const watchlist = readSet('games-calendar-watchlist-v2');
  const company = query.get('developer') ? {type:'developer', value:query.get('developer')} : query.get('publisher') ? {type:'publisher', value:query.get('publisher')} : null;
  const series = query.get('series') || '';

  let range = null;
  let period = 'month';
  const from = query.get('from');
  const to = query.get('to');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    period = 'custom';
    range = {from, to};
  } else if (query.get('period') === 'all') {
    period = 'all';
    range = null;
  } else if (query.get('period') === 'next') {
    period = 'next';
    const now = new Date();
    range = monthRange(now.getFullYear(), now.getMonth() + 1);
  } else if (['week','30','90','year','undated'].includes(query.get('period'))) {
    period = query.get('period');
    const today = todayLocal();
    const now = new Date(`${today}T00:00:00Z`);
    if (period === 'week') {
      const weekday = now.getUTCDay() || 7;
      const start = addDays(today, 1 - weekday);
      range = {from:start, to:addDays(start, 6)};
    } else if (period === '30') range = {from:today, to:addDays(today, 29)};
    else if (period === '90') range = {from:today, to:addDays(today, 89)};
    else if (period === 'year') range = {from:`${now.getUTCFullYear()}-01-01`, to:`${now.getUTCFullYear()}-12-31`};
    else range = null;
  } else if (/^\d{4}-\d{2}$/.test(query.get('month') || '')) {
    const [year, month] = query.get('month').split('-').map(Number);
    range = monthRange(year, month - 1);
  } else {
    const now = new Date();
    range = monthRange(now.getFullYear(), now.getMonth());
  }

  return { platforms, genres, search, status, precision, sort, watchlistOnly, watchlist, company, series, range, period };
}

function baseMatches(row, base, { ignoreRange = false } = {}) {
  const game = row.game;
  const search = normalizeSearch(base.search);
  if (search && !matchesSearch(game, search)) return false;
  if (base.platforms.size && !row.platformGroups.some(group => base.platforms.has(group))) return false;
  if (base.genres.size) {
    const labels = new Set((game.genres || []).map(formatGenre));
    if (![...base.genres].some(genre => labels.has(genre))) return false;
  }
  if (base.company?.value) {
    const source = base.company.type === 'developer' ? game.developers : game.publishers;
    if (!(source || []).includes(base.company.value)) return false;
  }
  if (base.series && !(game.series || []).includes(base.series)) return false;
  if (base.watchlistOnly && !base.watchlist.has(String(game.id))) return false;
  const precision = String(row.precision || (row.day ? 'day' : 'unknown')).toLowerCase();
  const precisionGroup = /^q[1-4]$|quarter|quarterly/.test(precision) ? 'quarter' : precision;
  if (!search && base.precision !== 'all' && precisionGroup !== base.precision) return false;
  if (!search && base.period === 'undated' && row.day) return false;

  const today = todayLocal();
  const from = row.from || row.day || null;
  const to = row.to || row.day || null;
  if (!search && base.status === 'upcoming' && to && to < today) return false;
  if (!search && base.status === 'released' && (!from || from >= today)) return false;

  if (!search && base.period === 'undated') return !from && !to;
  if (!search && !ignoreRange && base.range) {
    if (!from || !to) return false;
    if (to < base.range.from || from > base.range.to) return false;
  }
  return true;
}

function ratingValue(row) {
  const value = Number(row?.game?.rating || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function compareRatingRows(a, b, direction = 'desc') {
  const ar = ratingValue(a);
  const br = ratingValue(b);
  if (ar == null && br == null) return 0;
  if (ar == null) return 1;
  if (br == null) return -1;
  return direction === 'asc' ? ar - br : br - ar;
}

function sortRows(items, sort, search = '') {
  return [...items].sort((a, b) => {
    const ad = a.sortDay || a.day || '';
    const bd = b.sortDay || b.day || '';
    const searching = Boolean(normalizeSearch(search));

    if (sort === 'name-desc') return b.game.name.localeCompare(a.game.name, 'cs') || ad.localeCompare(bd);
    if (sort === 'name-asc') return a.game.name.localeCompare(b.game.name, 'cs') || ad.localeCompare(bd);

    if (sort === 'rating-desc' || sort === 'rating-asc') {
      const byRating = compareRatingRows(a, b, sort === 'rating-asc' ? 'asc' : 'desc');
      if (byRating) return byRating;
      if (searching) {
        const relevance = searchRelevance(b.game, search) - searchRelevance(a.game, search);
        if (relevance) return relevance;
      }
      return a.game.name.localeCompare(b.game.name, 'cs') || ad.localeCompare(bd);
    }

    if (!ad && bd) return 1;
    if (ad && !bd) return -1;
    if (ad !== bd) return sort === 'date-desc' ? bd.localeCompare(ad) : ad.localeCompare(bd);

    if (searching) {
      const relevance = searchRelevance(b.game, search) - searchRelevance(a.game, search);
      if (relevance) return relevance;
      const onlineOrder = (a.onlineOrder ?? Number.MAX_SAFE_INTEGER) - (b.onlineOrder ?? Number.MAX_SAFE_INTEGER);
      if (onlineOrder) return onlineOrder;
    }

    return a.game.name.localeCompare(b.game.name, 'cs');
  });
}

function searchCardKey(row) {
  return normalizeSearch(row?.game?.name) || String(row?.game?.id || '');
}

function searchReleaseKey(row) {
  return [
    searchCardKey(row),
    row?.day || row?.window || '',
    String(row?.precision || (row?.day ? 'day' : 'unknown')).toLowerCase()
  ].join('|');
}

function uniqueReleaseCount(items, search = '') {
  if (!normalizeSearch(search)) return items.length;
  return new Set(items.map(searchReleaseKey)).size;
}

function preferSearchCard(current, candidate) {
  if (!current) return candidate;

  const currentId = String(current?.game?.id || '');
  const candidateId = String(candidate?.game?.id || '');
  if (currentId === candidateId) {
    if (Boolean(current.day) !== Boolean(candidate.day)) return candidate.day ? candidate : current;
    if (candidate.day && current.day && candidate.day < current.day) return candidate;
    return current;
  }

  const currentRatings = Number(current?.game?.ratingCount || 0);
  const candidateRatings = Number(candidate?.game?.ratingCount || 0);
  if (candidateRatings !== currentRatings) return candidateRatings > currentRatings ? candidate : current;

  if (Boolean(current.day) !== Boolean(candidate.day)) return candidate.day ? candidate : current;
  if (candidate.day && current.day && candidate.day < current.day) return candidate;
  return current;
}

function collapseSearchCards(items, search = '') {
  if (!normalizeSearch(search)) return items;
  const unique = new Map();
  for (const row of items) {
    const key = searchCardKey(row);
    unique.set(key, preferSearchCard(unique.get(key), row));
  }
  return [...unique.values()];
}

function uniqueGameCount(items, { byTitle = false } = {}) {
  return new Set(items.map(row => byTitle ? searchCardKey(row) : String(row.game.id))).size;
}

function selectedTraitLabels() {
  return [...traits].map(key => TRAIT_LABELS.get(key) || key);
}

function ensureTraitUi() {
  const wrap = document.querySelector('.genre-filter-wrap');
  if (!wrap || wrap.querySelector('.trait-filter-section')) return;

  const section = document.createElement('section');
  section.className = 'trait-filter-section';
  section.innerHTML = `
    <div class="trait-filter-heading">
      <span>Další filtry</span>
      <button class="trait-filter-clear" type="button" ${traits.size ? '' : 'hidden'}>Zrušit výběr</button>
    </div>
    <div class="trait-filter-groups">
      ${TRAIT_GROUPS.map(group => `
        <div class="trait-filter-group" data-trait-group="${group.key}" data-trait-partition="${group.partition ? '1' : '0'}">
          <span class="trait-filter-group__label">${group.label}</span>
          <div class="trait-filter-list">
            ${group.items.map(([key, label]) => `<button type="button" class="genre-filter-chip trait-filter-chip ${traits.has(key) ? 'is-active' : ''}" data-trait="${key}" aria-pressed="${traits.has(key)}"><span>${label}</span><small data-trait-count="${key}">0</small></button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  wrap.appendChild(section);

  section.addEventListener('click', event => {
    const chip = event.target.closest('[data-trait]');
    if (chip) {
      const key = chip.dataset.trait;
      if (traits.has(key)) traits.delete(key); else traits.add(key);
      writeSet(TRAIT_KEY, traits);
      advancedLimit = PAGE_SIZE;
      syncTraitUi();
      if (!traits.size && wasFiltering) forceBaseRender(); else applyAdvancedFilters();
      return;
    }
    if (event.target.closest('.trait-filter-clear')) {
      traits.clear();
      writeSet(TRAIT_KEY, traits);
      advancedLimit = PAGE_SIZE;
      syncTraitUi();
      forceBaseRender();
    }
  });
}

function syncTraitUi() {
  document.querySelectorAll('[data-trait]').forEach(button => {
    const active = traits.has(button.dataset.trait);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const clear = document.querySelector('.trait-filter-clear');
  if (clear) clear.hidden = traits.size === 0;
}

function renderTraitCounts(baseRows) {
  const seenByTrait = new Map([...TRAIT_LABELS.keys()].map(key => [key, new Set()]));
  const baseGameIds = new Set();
  for (const row of baseRows) {
    const id = String(row.game.id);
    baseGameIds.add(id);
    for (const trait of gameTraits(row.game)) seenByTrait.get(trait)?.add(id);
  }
  for (const [key, set] of seenByTrait) {
    const counter = document.querySelector(`[data-trait-count="${CSS.escape(key)}"]`);
    const chip = document.querySelector(`[data-trait="${CSS.escape(key)}"]`);
    if (counter) counter.textContent = formatter.format(set.size);
    if (chip) chip.classList.toggle('is-empty', set.size === 0 && !traits.has(key));
  }

  for (const group of TRAIT_GROUPS) {
    const covered = new Set();
    for (const [key] of group.items) {
      for (const id of seenByTrait.get(key) || []) covered.add(id);
    }
    const node = document.querySelector(`[data-trait-group="${CSS.escape(group.key)}"]`);
    if (node) {
      node.dataset.filterCoverage = String(covered.size);
      node.dataset.filterTotal = String(baseGameIds.size);
      node.dataset.traitPartition = group.partition ? '1' : '0';
    }
  }
}

function renderAdvancedSummary(filtered, releaseCount = filtered.length, search = '') {
  const byTitle = Boolean(normalizeSearch(search));
  const gameCount = uniqueGameCount(filtered, { byTitle });
  const stat = $('stat-visible');
  if (stat) stat.textContent = formatter.format(gameCount);
  const summary = $('result-summary');
  if (!summary) return;
  const marker = ' · vlastnosti: ';
  const current = summary.textContent || '';
  const baseText = current.includes(marker) ? current.split(marker)[0] : current;
  const parts = baseText.split(' · ');
  parts[0] = `${formatter.format(gameCount)} her`;
  if (parts.length > 1) parts[1] = `${formatter.format(releaseCount)} vydání`;
  summary.textContent = `${parts.join(' · ')}${marker}${selectedTraitLabels().join(' + ')}`;
}

function updateMonthCounts(base) {
  if (!traits.size) return;
  const source = rows.filter(row => baseMatches(row, base, { ignoreRange: true }) && matchesSelectedTraits(row.game));
  const counts = new Map();
  for (const row of source) {
    const from = row.from || row.day || null;
    const to = row.to || row.day || null;
    if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) continue;
    const month = from.slice(0, 7);
    if (!counts.has(month)) counts.set(month, { games: new Set(), releases: 0, releaseKeys: new Set() });
    const entry = counts.get(month);
    const searching = Boolean(normalizeSearch(base.search));
    entry.games.add(searching ? searchCardKey(row) : String(row.game.id));
    if (searching) {
      entry.releaseKeys.add(searchReleaseKey(row));
      entry.releases = entry.releaseKeys.size;
    } else {
      entry.releases += 1;
    }
  }
  document.querySelectorAll('#month-rail [data-month]').forEach(tile => {
    const entry = counts.get(tile.dataset.month) || { games: new Set(), releases: 0 };
    const strong = tile.querySelector('strong');
    const small = tile.querySelector('small');
    if (strong) strong.textContent = `${formatter.format(entry.games.size)} her`;
    if (small) small.textContent = `${formatter.format(entry.releases)} vydání`;
  });
}

function decorateCard(card) {
  const key = card.dataset.rowKey;
  const row = rowMap.get(key);
  if (!row) return;
  card.querySelectorAll('.badge--content-type').forEach(node => node.remove());
  const type = contentType(row.game);
  if (!type || !badgePrefs.type) return;
  if (normalizeSearch(type) === 'plna hra' && !badgePrefs.fullType) return;
  const badges = card.querySelector('.card-badges');
  if (!badges) return;
  const badge = document.createElement('span');
  badge.className = `badge badge--content-type badge--type-${normalizeSearch(type).replace(/\s+/g, '-')}`;
  badge.textContent = type;
  badges.appendChild(badge);
}

function decorateCards() {
  document.querySelectorAll('#games .game-card').forEach(decorateCard);
}

function decorateDialog() {
  const dialog = $('game-dialog');
  if (!dialog?.open) return;
  const row = rowMap.get(dialog.dataset.rowKey);
  if (!row) return;
  const main = dialog.querySelector('.detail-main');
  if (!main) return;

  main.querySelectorAll('.detail-flag--content-type').forEach(node => node.remove());
  const type = contentType(row.game);
  if (type && badgePrefs.type && (normalizeSearch(type) !== 'plna hra' || badgePrefs.fullType)) {
    let flags = main.querySelector('.detail-flags');
    if (!flags) {
      flags = document.createElement('div');
      flags.className = 'detail-flags';
      const meta = main.querySelector('.detail-meta');
      meta?.insertAdjacentElement('afterend', flags);
    }
    const flag = document.createElement('span');
    flag.className = 'detail-flag detail-flag--content-type';
    flag.textContent = type;
    flags.appendChild(flag);
  }
}

function applyBadgePrefs() {
  const root = document.documentElement;
  const mapping = {
    release: 'hide-badge-release',
    scale: 'hide-badge-scale',
    type: 'hide-badge-type',
    early: 'hide-badge-early',
    services: 'hide-badge-services',
    rating: 'hide-card-rating'
  };
  for (const [key, className] of Object.entries(mapping)) root.classList.toggle(className, !badgePrefs[key]);
  decorateCards();
  decorateDialog();
}

function applyAdvancedFilters() {
  ensureTraitUi();
  if (!rows.length) return;
  const base = readBaseState();
  const baseRows = rows.filter(row => baseMatches(row, base));
  renderTraitCounts(baseRows);
  syncTraitUi();

  if (!traits.size) {
    wasFiltering = false;
    decorateCards();
    applyBadgePrefs();
    return;
  }

  const matched = baseRows.filter(row => matchesSelectedTraits(row.game));
  const filtered = sortRows(collapseSearchCards(matched, base.search), base.sort, base.search);
  const shown = filtered.slice(0, advancedLimit);
  const games = $('games');
  if (!games) return;
  const watchlist = base.watchlist;
  ignoreGameMutation = true;
  games.innerHTML = shown.map(row => rowCard(row, watchlist.has(String(row.game.id)))).join('');
  games.hidden = shown.length === 0;
  $('empty-state').hidden = filtered.length !== 0;
  $('load-more-wrap').hidden = filtered.length <= shown.length;
  wasFiltering = true;
  renderAdvancedSummary(filtered, uniqueReleaseCount(matched, base.search), base.search);
  updateMonthCounts(base);
  decorateCards();
  applyBadgePrefs();
}

function forceBaseRender() {
  wasFiltering = false;
  const sort = $('sort-filter');
  if (sort) sort.dispatchEvent(new Event('change', { bubbles: true }));
  else location.reload();
}

function setupSettings() {
  const popover = document.querySelector('.settings-popover');
  if (!popover || popover.querySelector('[data-advanced-settings]')) return;
  const group = document.createElement('div');
  group.className = 'settings-group';
  group.dataset.advancedSettings = '1';
  const badgeOptions = [
    ['release', 'Termín / odpočet'],
    ['scale', 'AAA / Indie'],
    ['type', 'Typ hry'],
    ['fullType', 'Odznak „Plná hra“'],
    ['early', 'Early Access'],
    ['services', 'Předplatné'],
    ['rating', 'Hodnocení']
  ];
  group.innerHTML = `
    <span class="settings-group__label">Odznaky na kartách</span>
    <div class="advanced-setting-list">
      ${badgeOptions.map(([key, label]) => `<label class="advanced-setting"><span>${label}</span><input type="checkbox" data-badge-pref="${key}" ${badgePrefs[key] ? 'checked' : ''}><i aria-hidden="true"></i></label>`).join('')}
    </div>
    <span class="settings-group__label settings-group__label--spaced">Detail hry</span>
    <label class="advanced-setting"><span>Gesta ← → / ↓</span><input type="checkbox" data-detail-gestures ${gesturesEnabled() ? 'checked' : ''}><i aria-hidden="true"></i></label>`;

  group.addEventListener('change', event => {
    const badge = event.target.closest('[data-badge-pref]');
    if (badge) {
      badgePrefs[badge.dataset.badgePref] = badge.checked;
      saveBadgePrefs();
      applyBadgePrefs();
      return;
    }
    if (event.target.matches('[data-detail-gestures]')) {
      localStorage.setItem(GESTURE_KEY, event.target.checked ? '1' : '0');
    }
  });
  popover.appendChild(group);
}

function currentAdvancedRows() {
  if (!rows.length) return [];
  const base = readBaseState();
  let list = rows.filter(row => baseMatches(row, base));
  if (traits.size) list = list.filter(row => matchesSelectedTraits(row.game));
  return sortRows(list, base.sort, base.search);
}

function openRowThroughApp(rowKey) {
  const games = $('games');
  if (!games || !rowKey) return;
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.hidden = true;
  ghost.dataset.openGame = rowKey;
  games.appendChild(ghost);
  ghost.click();
  ghost.remove();
  decorateDialog();
}

function navigateDialog(direction) {
  const dialog = $('game-dialog');
  const currentKey = dialog?.dataset.rowKey;
  if (!currentKey) return;
  const list = currentAdvancedRows();
  const index = list.findIndex(row => row.key === currentKey);
  if (index < 0 || list.length < 2) return;
  const nextIndex = (index + direction + list.length) % list.length;
  const next = list[nextIndex];
  openRowThroughApp(next.key);
  const content = $('dialog-content');
  content?.animate?.([
    { opacity: .55, transform: `translateX(${direction > 0 ? '16px' : '-16px'})` },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 170, easing: 'ease-out' });
}

function interactiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,select,textarea,video,iframe,.screenshot-rail,.gallery-item'));
}

function setupGestures() {
  const dialog = $('game-dialog');
  if (!dialog || dialog.dataset.advancedGestures === '1') return;
  dialog.dataset.advancedGestures = '1';

  dialog.addEventListener('pointerdown', event => {
    if (!gesturesEnabled()) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (interactiveTarget(event.target)) return;
    touchStart = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      scrollTop: dialog.scrollTop
    };
  });

  dialog.addEventListener('pointercancel', () => { touchStart = null; });
  dialog.addEventListener('pointerup', event => {
    if (!touchStart || !gesturesEnabled()) { touchStart = null; return; }
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    const elapsed = performance.now() - touchStart.time;
    const start = touchStart;
    touchStart = null;
    if (elapsed > 800) return;

    if (Math.abs(dx) >= 72 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      navigateDialog(dx < 0 ? 1 : -1);
      return;
    }
    if (dy >= 88 && Math.abs(dy) > Math.abs(dx) * 1.25 && start.scrollTop <= 8) {
      $('dialog-close')?.click();
    }
  });
}

function setupObservers() {
  const games = $('games');
  if (games) {
    const observer = new MutationObserver(() => {
      if (ignoreGameMutation) { ignoreGameMutation = false; return; }
      requestAnimationFrame(applyAdvancedFilters);
    });
    observer.observe(games, { childList: true });
  }

  const dialogContent = $('dialog-content');
  if (dialogContent) {
    const observer = new MutationObserver(() => requestAnimationFrame(() => {
      decorateDialog();
      applyBadgePrefs();
    }));
    observer.observe(dialogContent, { childList: true });
  }

  $('load-more')?.addEventListener('click', () => {
    if (!traits.size) return;
    advancedLimit += PAGE_SIZE;
    setTimeout(applyAdvancedFilters, 0);
  });
}

async function loadData() {
  try {
    const normalized = await loadGameData();
    const rawResponse = normalized.rawPayload || null;
    dataset = normalized.dataset;
    rawGameMap = new Map((rawResponse?.games || []).map(game => [String(game.id), game]));
    for (const game of dataset.games || []) {
      const raw = rawGameMap.get(String(game.id));
      if (!raw) continue;
      if (raw.contentType) game.contentType = raw.contentType;
      if (raw.subscriptions) game.subscriptions = { ...(game.subscriptions || {}), ...raw.subscriptions };
      if (raw.scale && !game.scale) game.scale = raw.scale;
      if (raw.earlyAccess) game.earlyAccess = true;
    }
    rows = flattenReleases(dataset);
    rowMap = new Map(rows.map(row => [row.key, row]));
    applyAdvancedFilters();
  } catch (error) {
    console.warn('Advanced filters:', error);
  }
}

window.addEventListener('games:rows-updated', event => {
  const available = Array.isArray(event.detail?.rows) ? event.detail.rows : [];
  if (!available.length) return;
  rows = available;
  rowMap = new Map(rows.map(row => [row.key, row]));
  for (const row of rows) rawGameMap.set(String(row.game.id), row.game);
  advancedLimit = PAGE_SIZE;
  applyAdvancedFilters();
});

function setup() {
  ensureStyles();
  ensureTraitUi();
  setupSettings();
  setupGestures();
  setupObservers();
  applyBadgePrefs();
  loadData();

  document.addEventListener('click', event => {
    if (event.target.closest('#reset-filters, #empty-reset')) {
      traits.clear();
      writeSet(TRAIT_KEY, traits);
      advancedLimit = PAGE_SIZE;
      syncTraitUi();
    }
  }, true);
}

setup();
