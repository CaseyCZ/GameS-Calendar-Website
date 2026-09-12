import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, titleScore, uniq } from '../lib/normalize.js';

const ENDPOINT = 'https://api-prod.nvidia.com/services/gfngames/v1/gameList';

function query(after = null) {
  const afterPart = after ? ` after:${JSON.stringify(after)}` : '';
  return `{ apps(country:${JSON.stringify(config.gfnCountry)} language:${JSON.stringify(config.gfnLanguage)} orderBy:"itemMetadata.gfnPopularityRank:ASC,sortName:ASC"${afterPart}) { numberReturned pageInfo { endCursor hasNextPage } items { id title sortName images { FEATURE_IMAGE TV_BANNER GAME_ICON GAME_LOGO GAME_BOX_ART } gfn { playType minimumMembershipTierLabel } variants { appStore publisherName storeUrl minimumSizeInBytes } } } }`;
}

function normalizeGfn(item) {
  const images = item?.images || {};
  const variants = item?.variants || [];
  const stores = uniq(variants.map(v => v?.appStore));
  return canonicalGame('geforceNow', {
    providerId: item?.id || item?.title,
    title: item?.title || item?.sortName || '',
    publishers: uniq(variants.map(v => v?.publisherName)),
    platforms: stores,
    media: {
      cover: images.GAME_BOX_ART || images.GAME_ICON || '',
      hero: images.FEATURE_IMAGE || images.TV_BANNER || '',
      logo: images.GAME_LOGO || ''
    },
    subscriptions: {
      geforceNow: true,
      geforceNowPlayType: item?.gfn?.playType || null,
      geforceNowMinTier: item?.gfn?.minimumMembershipTierLabel || null
    },
    storeUrl: item?.id ? `https://play.geforcenow.com/games?game-id=${encodeURIComponent(item.id)}&utm_source=games-calendar&utm_campaign=game-detail` : '',
    sourceUrl: ENDPOINT,
    rawHints: { stores, variants }
  });
}

export async function list({ force = false, maxPages = 12 } = {}) {
  const key = `gfn:list:${config.gfnCountry}:${config.gfnLanguage}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const items = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchJson(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: query(after)
    });
    const apps = payload?.data?.apps || payload?.apps;
    if (!apps) throw new Error('Unexpected GeForce NOW gameList response');
    items.push(...(apps.items || []));
    if (!apps.pageInfo?.hasNextPage || !apps.pageInfo?.endCursor || !(apps.items || []).length) break;
    after = apps.pageInfo.endCursor;
  }
  const normalized = items.map(normalizeGfn).filter(item => item?.title);
  return cachePut(key, 'geforceNow', normalized, config.ttl.gfn);
}

export async function search(queryText, { force = false, limit = 8 } = {}) {
  const q = String(queryText || '').trim();
  if (!q) return [];
  const all = await list({ force });
  return all.map(item => ({ item, score: titleScore(q, item.title) }))
    .filter(entry => entry.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

export const geforceNowProvider = {
  name: 'geforceNow',
  capabilities: ['catalog', 'search', 'playType', 'stores'],
  list,
  search,
  health: async () => {
    const all = await list({ force: true, maxPages: 1 });
    return { ok: all.length > 0, firstPageCount: all.length, endpoint: ENDPOINT };
  }
};
