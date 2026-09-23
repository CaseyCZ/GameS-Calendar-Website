import { config } from '../config.js';
import { cacheGet, cachePut } from '../db.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGame, storefrontTitleScore } from '../lib/normalize.js';
import { epicIsGameOffer, epicPriceOf, epicStoreUrlOf } from '../lib/epic-store.js';

const GRAPHQL = 'https://graphql.epicgames.com/graphql';

const SEARCH_QUERY = `
query searchStoreQuery(
  $count: Int,
  $country: String!,
  $keywords: String,
  $locale: String,
  $sortBy: String,
  $sortDir: String,
  $start: Int,
  $withPrice: Boolean = true
) {
  Catalog {
    searchStore(
      count: $count,
      country: $country,
      keywords: $keywords,
      locale: $locale,
      sortBy: $sortBy,
      sortDir: $sortDir,
      start: $start
    ) {
      elements {
        title
        id
        namespace
        description
        effectiveDate
        releaseDate
        pcReleaseDate
        offerType
        developerDisplayName
        publisherDisplayName
        productSlug
        urlSlug
        url
        keyImages {
          type
          url
        }
        seller {
          name
        }
        categories {
          path
        }
        catalogNs {
          mappings(pageType: "productHome") {
            pageSlug
            pageType
          }
        }
        offerMappings {
          pageSlug
          pageType
        }
        price(country: $country) @include(if: $withPrice) {
          totalPrice {
            discountPrice
            originalPrice
            voucherDiscount
            discount
            currencyCode
            currencyInfo {
              decimals
            }
            fmtPrice(locale: $locale) {
              originalPrice
              discountPrice
              intermediatePrice
            }
          }
        }
      }
      paging {
        count
        total
      }
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
      effectiveDate: item.effectiveDate || ''
    }
  });
}

async function searchStore(query, { force = false, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(20, Number(limit) || 8));
  const requestCount = Math.min(40, Math.max(12, take * 4));
  const key = `epic:search:${config.epicCountry}:${config.epicLocale}:${q.toLowerCase()}:${requestCount}`;
  if (!force) {
    const cached = cacheGet(key);
    if (cached) return cached.slice(0, take);
  }

  const payload = await fetchJson(GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://store.epicgames.com',
      referer: 'https://store.epicgames.com/'
    },
    body: JSON.stringify({
      operationName: 'searchStoreQuery',
      query: SEARCH_QUERY,
      variables: {
        count: requestCount,
        country: config.epicCountry,
        keywords: q,
        locale: config.epicLocale,
        sortBy: 'relevancy',
        sortDir: 'DESC',
        start: 0,
        withPrice: true
      }
    })
  });

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
    const hits = await searchStore('Fortnite', { force: true, limit: 1 });
    return {
      ok: Boolean(hits[0]?.title),
      sample: hits[0]?.title || null,
      country: config.epicCountry,
      locale: config.epicLocale
    };
  }
};
