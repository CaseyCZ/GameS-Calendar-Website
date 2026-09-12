export const uniq = values => [...new Set((values || []).filter(Boolean))];

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
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(standard|deluxe|ultimate|complete|premium|definitive|collector'?s?|cross[- ]gen) edition\b/g, ' ')
    .replace(/\b(playstation 5|playstation 4|ps5|ps4|xbox series x\|s|xbox series|xbox one|nintendo switch 2|nintendo switch|windows|pc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function mergeGames(games = []) {
  const valid = games.filter(Boolean);
  if (!valid.length) return null;
  const preferred = [...valid].sort((a, b) => {
    const rank = { microsoft: 5, playstation: 5, nintendo: 5, steam: 4, geforceNow: 2 };
    return (rank[b.provider] || 0) - (rank[a.provider] || 0);
  });
  const first = preferred[0];
  const sourceFor = (key, predicate = value => Boolean(value)) => preferred.find(item => predicate(item?.[key])) || null;
  const titleSource = sourceFor('title');
  const descriptionSource = sourceFor('description');
  const shortDescriptionSource = sourceFor('shortDescription');
  const coverSource = preferred.find(item => item.media?.cover) || null;
  const heroSource = preferred.find(item => item.media?.hero) || null;
  return {
    title: titleSource?.title || first.title,
    description: descriptionSource?.description || '',
    shortDescription: shortDescriptionSource?.shortDescription || '',
    developers: uniq(valid.flatMap(item => item.developers || [])),
    publishers: uniq(valid.flatMap(item => item.publishers || [])),
    genres: uniq(valid.flatMap(item => item.genres || [])),
    categories: uniq(valid.flatMap(item => item.categories || [])),
    platforms: uniq(valid.flatMap(item => item.platforms || [])),
    releaseDates: Object.fromEntries(valid.filter(item => item.releaseDate).map(item => [item.provider, item.releaseDate])),
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
      releaseDate: Object.fromEntries(valid.filter(item => item.releaseDate).map(item => [item.provider, item.releaseDate]))
    },
    providers: Object.fromEntries(valid.map(item => [item.provider, item])),
    fetchedAt: new Date().toISOString()
  };
}
