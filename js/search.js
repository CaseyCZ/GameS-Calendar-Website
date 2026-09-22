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

export function preferDisplayRow(current, candidate) {
  if (!current) return candidate;

  if (Boolean(current.onlineResult) !== Boolean(candidate.onlineResult)) {
    return current.onlineResult ? candidate : current;
  }

  const typeScore = row => {
    const type = normalizeSearch(row?.game?.contentType || '');
    if (!type || type === 'game' || type === 'main game' || type === 'plna hra') return 2;
    if (['remake','remaster','expanded game','standalone expansion'].includes(type)) return 1;
    return 0;
  };
  const currentType = typeScore(current);
  const candidateType = typeScore(candidate);
  if (candidateType !== currentType) return candidateType > currentType ? candidate : current;

  const currentCertainty = releaseCertaintyRank(current);
  const candidateCertainty = releaseCertaintyRank(candidate);
  if (candidateCertainty !== currentCertainty) return candidateCertainty < currentCertainty ? candidate : current;

  const currentRatings = Number(current?.game?.ratingCount || 0);
  const candidateRatings = Number(candidate?.game?.ratingCount || 0);
  if (candidateRatings !== currentRatings) return candidateRatings > currentRatings ? candidate : current;

  const currentDate = current.sortDay || current.day || '';
  const candidateDate = candidate.sortDay || candidate.day || '';
  if (currentDate && candidateDate && candidateDate !== currentDate) return candidateDate < currentDate ? candidate : current;
  if (!currentDate && candidateDate) return candidate;
  return current;
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
  const mergedPlatforms = new Map();
  const mergedGroups = new Map();

  for (const row of rows || []) {
    const key = displayFamilyKey(row);
    const current = unique.get(key);
    unique.set(key, current ? prefer(current, row) : row);

    if (!mergedPlatforms.has(key)) mergedPlatforms.set(key, new Map());
    for (const platform of row?.platforms || []) {
      const platformKey = String(platform?.group || platform?.abbreviation || platform?.name || platform || '').trim();
      if (platformKey && !mergedPlatforms.get(key).has(platformKey)) mergedPlatforms.get(key).set(platformKey, platform);
    }

    if (!mergedGroups.has(key)) mergedGroups.set(key, new Set());
    for (const group of row?.platformGroups || []) if (group) mergedGroups.get(key).add(group);
  }

  return [...unique.entries()].map(([key, row]) => ({
    ...row,
    platforms: mergedPlatforms.get(key)?.size ? [...mergedPlatforms.get(key).values()] : (row?.platforms || []),
    platformGroups: mergedGroups.get(key)?.size ? [...mergedGroups.get(key)] : (row?.platformGroups || [])
  }));
}

export function matchesReleaseRange(row = {}, range = null, period = 'all') {
  const from = row.from || row.day || null;
  const to = row.to || row.day || null;
  if (period === 'undated') return !from && !to;
  if (!range) return true;
  if (!from || !to) return false;

  if (period === 'month' || period === 'next') {
    const precision = String(row.precision || (row.day ? 'day' : 'unknown')).toLowerCase();
    const group = /^q[1-4]$|quarter|quarterly/.test(precision) ? 'quarter' : precision;
    if (group !== 'day' && group !== 'month') return false;
  }

  return to >= range.from && from <= range.to;
}

export function collapseCalendarRows(rows = []) {
  const unique = new Map();
  const platformsByKey = new Map();
  const groupsByKey = new Map();

  for (const row of rows || []) {
    if (!row?.day) continue;
    const key = `${gameIdentity(row.game)}|${row.day}`;
    if (!unique.has(key)) unique.set(key, row);

    if (!platformsByKey.has(key)) platformsByKey.set(key, new Map());
    for (const platform of row.platforms || []) {
      const platformKey = String(platform?.group || platform?.abbreviation || platform?.name || platform || '').trim();
      if (platformKey && !platformsByKey.get(key).has(platformKey)) platformsByKey.get(key).set(platformKey, platform);
    }

    if (!groupsByKey.has(key)) groupsByKey.set(key, new Set());
    for (const group of row.platformGroups || []) if (group) groupsByKey.get(key).add(group);
  }

  return [...unique.entries()].map(([key, row]) => ({
    ...row,
    platforms: platformsByKey.get(key)?.size ? [...platformsByKey.get(key).values()] : (row.platforms || []),
    platformGroups: groupsByKey.get(key)?.size ? [...groupsByKey.get(key)] : (row.platformGroups || [])
  }));
}

export function watchedFamilyKeys(rows = [], watchedIds = []) {
  const watched = watchedIds instanceof Set
    ? new Set([...watchedIds].map(String))
    : new Set((watchedIds || []).map(String));
  const families = new Set();

  for (const row of rows || []) {
    const id = String(row?.game?.id || '');
    if (id && watched.has(id)) families.add(displayFamilyKey(row));
  }
  return families;
}

export function countWatchedFamilies(rows = [], watchedIds = []) {
  const watched = watchedIds instanceof Set
    ? new Set([...watchedIds].map(String))
    : new Set((watchedIds || []).map(String));
  const matchedIds = new Set();

  for (const row of rows || []) {
    const id = String(row?.game?.id || '');
    if (id && watched.has(id)) matchedIds.add(id);
  }

  let count = watchedFamilyKeys(rows, watched).size;
  for (const id of watched) if (!matchedIds.has(id)) count += 1;
  return count;
}
