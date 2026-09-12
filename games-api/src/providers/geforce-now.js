import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, titleScore, uniq } from '../lib/normalize.js';

const PRIMARY_ENDPOINT = 'https://games.geforce.com/graphql';
const FALLBACK_ENDPOINT = 'https://api-prod.nvidia.com/services/gfngames/v1/gameList';

function query(after = '') {
  return `{ apps(country:${JSON.stringify(config.gfnCountry)} language:${JSON.stringify(config.gfnLanguage)} after:${JSON.stringify(after || '')}) { numberReturned pageInfo { endCursor hasNextPage } items { id cmsId title sortName type images { GAME_BOX_ART KEY_ART HERO_IMAGE TV_BANNER GAME_ICON GAME_LOGO } variants { id title appStore publisherName osType storeId shortName storeUrl gfn { releaseDate status } } } } }`;
}

async function fetchPage(after = '') {
  const graph = query(after);
  const primary = new URL(PRIMARY_ENDPOINT);
  primary.searchParams.set('requestType', 'apps');
  primary.searchParams.set('query', graph);

  try {
    return await fetchJson(primary, { attempts: 1, timeoutMs: 12_000 });
  } catch (primaryError) {
    try {
      return await fetchJson(FALLBACK_ENDPOINT, {
        method: 'POST',
        attempts: 1,
        timeoutMs: 12_000,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'nv-browser-type': 'CHROME',
          'nv-client-streamer': 'WEBRTC',
          'nv-client-type': 'BROWSER',
          'nv-device-os': 'LINUX',
          'nv-device-type': 'DESKTOP'
        },
        body: graph
      });
    } catch (fallbackError) {
      throw new Error(`GeForce NOW primary failed: ${primaryError?.message || primaryError}; fallback failed: ${fallbackError?.message || fallbackError}`);
    }
  }
}

function normalizeGfn(item) {
  const images = item?.images || {};
  const variants = item?.variants || [];
  const stores = uniq(variants.map(v => v?.appStore).filter(Boolean));
  const publishers = uniq(variants.map(v => v?.publisherName).filter(Boolean));
  const releases = variants.map(v => v?.gfn?.releaseDate).filter(Boolean).sort();
  const statuses = uniq(variants.map(v => v?.gfn?.status).filter(Boolean));
  return canonicalGame('geforceNow', {
    providerId: item?.id || item?.cmsId || item?.title,
    title: item?.title || item?.sortName || '',
    publishers,
    platforms: stores,
    releaseDate: releases[0] || null,
    media: {
      cover: images.GAME_BOX_ART || images.KEY_ART || images.GAME_ICON || '',
      hero: images.HERO_IMAGE || images.FEATURE_IMAGE || images.TV_BANNER || '',
      logo: images.GAME_LOGO || ''
    },
    subscriptions: {
      geforceNow: true
    },
    storeUrl: item?.id ? `https://play.geforcenow.com/games?game-id=${encodeURIComponent(item.id)}&utm_source=games-calendar&utm_campaign=game-detail` : '',
    sourceUrl: PRIMARY_ENDPOINT,
    rawHints: {
      cmsId: item?.cmsId || null,
      type: item?.type || null,
      stores,
      statuses,
      variants
    }
  });
}

export async function list({ force = false, maxPages = 12 } = {}) {
  const key = `gfn:list:${config.gfnCountry}:${config.gfnLanguage}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const items = [];
  let after = '';
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage(after);
    const apps = payload?.data?.apps || payload?.apps;
    if (!apps) throw new Error('Unexpected GeForce NOW catalog response');
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
  capabilities: ['catalog', 'search', 'stores', 'releaseDate'],
  list,
  search,
  health: async () => {
    const all = await list({ force: true, maxPages: 1 });
    return {
      ok: all.length > 0,
      firstPageCount: all.length,
      endpoint: PRIMARY_ENDPOINT,
      fallbackEndpoint: FALLBACK_ENDPOINT
    };
  }
};
