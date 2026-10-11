import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, storefrontTitleScore } from '../lib/normalize.js';
import { epicIsGameOffer, epicPriceOf, epicStoreUrlOf } from '../lib/epic-store.js';

const GRAPHQL = 'https://launcher.store.epicgames.com/graphql';
const SEARCH_HASH = '7d58e12d9dd8cb14c84a3ff18d360bf9f0caa96bf218f2c5fda68ba88d68a437';
const EPIC_LAUNCHER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher';

const SEARCH_QUERY = `
query searchStoreQuery(
  $allowCountries: String,
  $category: String,
  $count: Int,
  $country: String!,
  $keywords: String,
  $locale: String,
  $sortBy: String,
  $sortDir: String,
  $start: Int,
  $tag: String,
  $withPrice: Boolean = true
) {
  Catalog {
    searchStore(
      allowCountries: $allowCountries
      category: $category
      count: $count
      country: $country
      keywords: $keywords
      locale: $locale
      sortBy: $sortBy
      sortDir: $sortDir
      start: $start
      tag: $tag
    ) {
      elements {
        title
        id
        namespace
        description
        effectiveDate
        releaseDate
        pcReleaseDate
        prePurchase
        offerType
        developerDisplayName
        publisherDisplayName
        productSlug
        urlSlug
        url
        keyImages { type url }
        seller { name }
        categories { path }
        catalogNs { mappings(pageType: "productHome") { pageSlug pageType } }
        offerMappings { pageSlug pageType }
        price(country: $country) @include(if: $withPrice) {
          totalPrice {
            discountPrice
            originalPrice
            voucherDiscount
            discount
            currencyCode
            currencyInfo { decimals }
            fmtPrice(locale: $locale) {
              originalPrice
              discountPrice
              intermediatePrice
            }
          }
        }
      }
      paging { count total }
    }
  }
}
`;

function imageOf(item, types) {
  for (const type of types) {
    const hit = (item?.keyImages || []).find(image => String(image?.type || '').toLowerCase() === type.toLowerCase());
    if (hit?.url) return hit.url;
  }
  return '';
}

function normalizeEpic(item = {}) {
  const title = String(item.title || '').trim();
  const storeUrl = epicStoreUrlOf(item, { locale: config.epicLocale });
  const price = epicPriceOf(item);
  const publisher = String(item.publisherDisplayName || item?.seller?.name || '').trim();
  const developer = String(item.developerDisplayName || '').trim();

  return canonicalGame('epic', {
    providerId: item.id,
    title,
    description: item.description || '',
    developers: developer ? [developer] : [],
    publishers: publisher ? [publisher] : [],
    platforms: ['PC'],
    releaseDate: item.pcReleaseDate || item.releaseDate || null,
    price,
    media: {
      cover: imageOf(item, ['OfferImageTall', 'DieselGameBoxTall', 'Thumbnail']),
      hero: imageOf(item, ['OfferImageWide', 'DieselGameBox', 'Featured'])
    },
    storeUrl,
    sourceUrl: GRAPHQL,
    rawHints: {
      namespace: item.namespace || '',
      offerType: item.offerType || '',
      categories: (item.categories || []).map(entry => entry?.path).filter(Boolean),
      effectiveDate: item.effectiveDate || '',
      releaseDate: item.releaseDate || '',
      pcReleaseDate: item.pcReleaseDate || '',
      prePurchase: item.prePurchase ?? null,
      priceSuppressed: Boolean(item?.price?.totalPrice && !price)
    }
  });
}

async function searchStore(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(20, Number(limit) || 8));
  const requestCount = Math.min(40, Math.max(12, take * 4));
  const key = `epic:search:v2:${config.epicCountry}:${config.epicLocale}:${q.toLowerCase()}:${requestCount}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, take);
  }

  const variables = {
    allowCountries: config.epicCountry,
    category: 'games/edition/base|games/edition',
    count: requestCount,
    country: config.epicCountry,
    keywords: q,
    locale: config.epicLocale,
    sortBy: 'relevancy,viewableDate',
    sortDir: 'DESC,DESC',
    start: 0,
    tag: '9547',
    withPrice: true
  };
  const url = new URL(GRAPHQL);
  url.searchParams.set('operationName', 'searchStoreQuery');
  url.searchParams.set('variables', JSON.stringify(variables));
  url.searchParams.set('extensions', JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: SEARCH_HASH }
  }));

  const headers = {
    'user-agent': EPIC_LAUNCHER_UA,
    'x-requested-with': 'XMLHttpRequest',
    origin: 'https://store.epicgames.com',
    referer: 'https://store.epicgames.com/'
  };
  let payload = await fetchJson(url, { headers });

  const persistedMissing = (payload?.errors || []).some(error =>
    /PersistedQueryNotFound/i.test(String(error?.message || ''))
  );
  if (persistedMissing) {
    payload = await fetchJson(GRAPHQL, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        operationName: 'searchStoreQuery',
        query: SEARCH_QUERY,
        variables
      })
    });
  }

  if (payload?.errors?.length) {
    throw new Error(`Epic searchStore: ${payload.errors.map(item => item?.message || 'GraphQL error').join('; ')}`);
  }

  const items = (payload?.data?.Catalog?.searchStore?.elements || [])
    .filter(epicIsGameOffer)
    .map(normalizeEpic)
    .filter(item => item.title)
    .sort((a, b) => storefrontTitleScore(q, b.title) - storefrontTitleScore(q, a.title));

  cachePut(key, 'epic', items, config.ttl.search);
  return items.slice(0, take);
}

export const epicProvider = {
  name: 'epic',
  capabilities: ['search', 'price', 'media'],
  search: searchStore,
  health: async () => {
    const hits = await searchStore('SILENT HILL: Townfall', { force: true, limit: 5 });
    const sample = hits.find(item => /silent hill\s*:?\s*townfall/i.test(item?.title || '')) || hits[0] || null;
    const current = Number(sample?.price?.current);
    return {
      ok: Boolean(sample?.title && sample?.storeUrl),
      sample: sample?.title || null,
      samplePrice: sample?.price || null,
      storeUrl: sample?.storeUrl || null,
      country: config.epicCountry,
      locale: config.epicLocale
    };
  }
};
