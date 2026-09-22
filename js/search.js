const ROMAN = new Map([
  ['i','1'],['ii','2'],['iii','3'],['iv','4'],['v','5'],['vi','6'],['vii','7'],['viii','8'],['ix','9'],['x','10']
]);

export function normalizeSearch(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => ROMAN.get(token) || token)
    .join(' ');
}

export function gameSearchText(game = {}) {
  return normalizeSearch([
    game.name,
    ...(game.aliases || []),
    ...(game.developers || []),
    ...(game.publishers || []),
    ...(game.series || [])
  ].join(' '));
}

export function matchesSearch(game, query) {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  const haystack = gameSearchText(game);
  return haystack.includes(needle)
    || needle.split(' ').filter(Boolean).every(word => haystack.includes(word));
}

export function searchRelevance(game = {}, query = '') {
  const needle = normalizeSearch(query);
  const name = normalizeSearch(game.name);
  const aliases = (game.aliases || []).map(normalizeSearch);
  if (!needle) return 0;
  if (name === needle) return 100;
  if (aliases.includes(needle)) return 95;
  if (name.startsWith(needle)) return 85;
  if (name.includes(needle)) return 75;
  if (aliases.some(alias => alias.startsWith(needle))) return 70;
  const words = needle.split(' ').filter(Boolean);
  return words.filter(word => gameSearchText(game).includes(word)).length / Math.max(1, words.length) * 50;
}

export function gameIdentity(game = {}) {
  const igdbId = String(game.igdbId || '').trim();
  if (igdbId) return `igdb:${igdbId}`;
  const id = String(game.id || '').trim();
  if (id) return `id:${id}`;
  return `title:${normalizeSearch(game.name || '')}`;
}

export function collapseGameRows(rows = [], prefer = (current) => current) {
  const unique = new Map();
  for (const row of rows || []) {
    const key = gameIdentity(row?.game);
    const current = unique.get(key);
    unique.set(key, current ? prefer(current, row) : row);
  }
  return [...unique.values()];
}

export function releaseCertaintyRank(row = {}) {
  const precision = String(row.precision || (row.day ? 'day' : 'unknown')).toLowerCase();
  if (row.day && precision === 'day') return 0;
  if (precision === 'month') return 1;
  if (/^q[1-4]$|quarter|quarterly/.test(precision)) return 2;
  if (precision === 'year') return 3;
  return 4;
}

export function displayFamilyKey(row = {}) {
  const game = row.game || {};
  const name = normalizeSearch(game.name || '');
  const tokens = name.split(' ').filter(Boolean);
  const developer = normalizeSearch((game.developers || [])[0] || '');
  const type = normalizeSearch(game.contentType || 'main game') || 'main game';
  const dateText = String(row.day || row.sortDay || row.window || '');
  const year = dateText.match(/\b(20\d{2})\b/)?.[1] || '';

  // Collapse narrow numeric reskin families such as
  // "100 Cats Argentina" / "100 Amsterdam Cats".
  // Restrict the heuristic to a high numeric prefix + same developer/type/year.
  const prefix = Number(tokens[0]);
  const words = tokens
    .slice(1)
    .filter(token => /^[a-z][a-z0-9]*$/.test(token) && token.length >= 3)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (tokens.length >= 3 && Number.isInteger(prefix) && prefix >= 50 && words.length && developer && year) {
    return `variant:${prefix}:${words[0]}|${developer}|${type}|${year}`;
  }
  return gameIdentity(game);
}

export function collapseDisplayRows(rows = [], prefer = current => current) {
  const unique = new Map();
  for (const row of rows || []) {
    const key = displayFamilyKey(row);
    const current = unique.get(key);
    unique.set(key, current ? prefer(current, row) : row);
  }
  return [...unique.values()];
}
