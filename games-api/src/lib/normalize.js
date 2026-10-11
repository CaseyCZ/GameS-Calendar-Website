export const uniq = values => [...new Set((values || []).filter(Boolean))];

const ROMAN_NUMERALS = new Map([
  ['i','1'],
  ['ii','2'],
  ['iii','3'],
  ['iv','4'],
  ['v','5'],
  ['vi','6'],
  ['vii','7'],
  ['viii','8'],
  ['ix','9'],
  ['x','10'],
  ['xi','11'],
  ['xii','12'],
  ['xiii','13'],
  ['xiv','14'],
  ['xv','15'],
  ['xvi','16'],
  ['xvii','17'],
  ['xviii','18'],
  ['xix','19'],
  ['xx','20']
]);

function normalizeRomanTokens(value = '') {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(token => ROMAN_NUMERALS.get(token) || token)
    .join(' ');
}

function basicTitle(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleQueryVariants(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const plain = basicTitle(raw);
  const roman = normalizeRomanTokens(plain);
  return uniq([raw, ...(roman && roman !== plain ? [roman] : [])]);
}

export function cleanText(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(value = '') {
  const cleaned = String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(standard|deluxe|ultimate|complete|premium|definitive|collector'?s?|cross[- ]gen) edition\b/g, ' ')
    .replace(/\b(playstation 5|playstation 4|ps5|ps4|xbox series x\|s|xbox series|xbox one|nintendo switch 2|nintendo switch|windows|pc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeRomanTokens(cleaned);
}

export function slugify(value = '') {
  return normalizeTitle(value).replace(/\s+/g, '-');
}

export function titleScore(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length) * 0.95;
  const la = new Set(left.split(' '));
  const rb = new Set(right.split(' '));
  let overlap = 0;
  for (const token of la) if (rb.has(token)) overlap += 1;
  const union = new Set([...la, ...rb]).size || 1;
  return overlap / union;
}

const STORE_EDITION_RE = /\b(deluxe|ultimate|premium|complete|definitive|collector'?s?|gold|special|vault|anniversary)\s+(?:digital\s+)?edition\b/g;
const STORE_AUXILIARY_RE = /\b(?:upgrade(?:\s+(?:pack|kit))?|season\s+pass|dlc|add[- ]?on|bonus\s+content\s+pack)\b/;

function storeEditionTags(value = '') {
  const text = basicTitle(value);
  return new Set([...text.matchAll(STORE_EDITION_RE)].map(match => match[1]));
}

export function storefrontTitleScore(query, candidate) {
  const base = titleScore(query, candidate);
  if (!base) return 0;

  const queryRaw = basicTitle(query);
  const candidateRaw = basicTitle(candidate);
  const queryEditions = storeEditionTags(query);
  const candidateEditions = storeEditionTags(candidate);
  const queryAuxiliary = STORE_AUXILIARY_RE.test(queryRaw);
  const candidateAuxiliary = STORE_AUXILIARY_RE.test(candidateRaw);
  STORE_AUXILIARY_RE.lastIndex = 0;

  let score = base;
  if (queryRaw === candidateRaw) score += 0.08;

  if (!queryEditions.size && candidateEditions.size) {
    score -= 0.22;
  } else if (queryEditions.size) {
    const sameEdition = [...queryEditions].some(tag => candidateEditions.has(tag));
    score += sameEdition ? 0.06 : -0.28;
  }

  if (!queryAuxiliary && candidateAuxiliary) score -= 0.35;
  else if (queryAuxiliary && !candidateAuxiliary) score -= 0.2;

  return Math.max(0, score);
}

export function isoDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function canonicalGame(provider, fields = {}) {
  return {
    provider,
    providerId: fields.providerId ? String(fields.providerId) : null,
    title: fields.title || '',
    description: fields.description || '',
    shortDescription: fields.shortDescription || '',
    developers: uniq(fields.developers || []),
    publishers: uniq(fields.publishers || []),
    genres: uniq(fields.genres || []),
    categories: uniq(fields.categories || []),
    platforms: uniq(fields.platforms || []),
    releaseDate: isoDate(fields.releaseDate),
    earlyAccess: Boolean(fields.earlyAccess),
    rating: Number(fields.rating || 0) || null,
    ratingCount: Number(fields.ratingCount || 0) || null,
    price: fields.price || null,
    media: {
      cover: fields.media?.cover || '',
      hero: fields.media?.hero || '',
      logo: fields.media?.logo || '',
      screenshots: uniq(fields.media?.screenshots || []),
      trailers: uniq(fields.media?.trailers || [])
    },
    subscriptions: fields.subscriptions || {},
    storeUrl: fields.storeUrl || '',
    sourceUrl: fields.sourceUrl || '',
    rawHints: fields.rawHints || {},
    fetchedAt: new Date().toISOString()
  };
}

function uniqueObjects(values, keyFn) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!value) continue;
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function mergeGames(games = []) {
  const valid = games.filter(Boolean);
  if (!valid.length) return null;
  const preferred = [...valid].sort((a, b) => {
    const rank = { microsoft: 6, playstation: 6, nintendo: 6, steam: 5, igdb: 4, geforceNow: 2 };
    return (rank[b.provider] || 0) - (rank[a.provider] || 0);
  });
  const first = preferred[0];
  const sourceFor = (key, predicate = value => Boolean(value)) => preferred.find(item => predicate(item?.[key])) || null;
  const titleSource = sourceFor('title');
  const descriptionSource = sourceFor('description');
  const shortDescriptionSource = sourceFor('shortDescription');
  const coverSource = preferred.find(item => item.media?.cover) || null;
  const heroSource = preferred.find(item => item.media?.hero) || null;
  const metadataSource = preferred.find(item => item.provider === 'igdb') || null;
  const providerReleaseDates = Object.fromEntries(valid.filter(item => item.releaseDate).map(item => [item.provider, item.releaseDate]));
  const platformReleaseDates = uniqueObjects(
    valid.flatMap(item => Array.isArray(item.releaseDates) ? item.releaseDates : []),
    item => `${item.day || ''}|${item.platform || ''}`
  );
  const videos = uniqueObjects(
    valid.flatMap(item => Array.isArray(item.videos) ? item.videos : []),
    item => item.id || item.url || item.name
  );
  const externalIds = Object.assign({}, ...valid.map(item => item.externalIds || item.rawHints?.externalIds || {}));

  return {
    title: titleSource?.title || first.title,
    description: descriptionSource?.description || '',
    shortDescription: shortDescriptionSource?.shortDescription || '',
    developers: uniq(valid.flatMap(item => item.developers || [])),
    publishers: uniq(valid.flatMap(item => item.publishers || [])),
    genres: uniq(valid.flatMap(item => item.genres || [])),
    categories: uniq(valid.flatMap(item => item.categories || [])),
    platforms: uniq(valid.flatMap(item => item.platforms || [])),
    aliases: uniq(valid.flatMap(item => item.aliases || item.rawHints?.aliases || [])),
    series: uniq(valid.flatMap(item => item.series || [])),
    gameModes: uniq(valid.flatMap(item => item.gameModes || item.rawHints?.gameModes || [])),
    perspectives: uniq(valid.flatMap(item => item.perspectives || item.rawHints?.perspectives || [])),
    themes: uniq(valid.flatMap(item => item.themes || item.rawHints?.themes || [])),
    gameType: metadataSource?.gameType || metadataSource?.rawHints?.gameType || null,
    externalIds,
    releaseDates: platformReleaseDates,
    providerReleaseDates,
    videos,
    websites: uniq(valid.flatMap(item => item.websites || item.rawHints?.websites || [])),
    media: {
      cover: coverSource?.media.cover || '',
      hero: heroSource?.media.hero || '',
      screenshots: uniq(valid.flatMap(item => item.media?.screenshots || [])).slice(0, 24),
      trailers: uniq(valid.flatMap(item => item.media?.trailers || [])).slice(0, 8)
    },
    subscriptions: Object.assign({}, ...valid.map(item => item.subscriptions || {})),
    fieldSources: {
      title: titleSource?.provider || null,
      description: descriptionSource?.provider || null,
      shortDescription: shortDescriptionSource?.provider || null,
      cover: coverSource?.provider || null,
      hero: heroSource?.provider || null,
      releaseDate: providerReleaseDates,
      metadata: metadataSource?.provider || null
    },
    providers: Object.fromEntries(valid.map(item => [item.provider, item])),
    fetchedAt: new Date().toISOString()
  };
}
