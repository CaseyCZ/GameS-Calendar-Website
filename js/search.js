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
