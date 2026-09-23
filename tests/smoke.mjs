import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { flattenReleases, normalizePayload, platformGroup, releaseBounds } from '../js/data.js';
import { normalizeTitle, storefrontTitleScore, titleQueryVariants, titleScore } from '../games-api/src/lib/normalize.js';
import { consolidateMicrosoftSearch, microsoftPriceOf } from '../games-api/src/lib/microsoft-pricing.js';
import { epicIsGameOffer, epicPriceOf, epicStoreUrlOf } from '../games-api/src/lib/epic-store.js';
import { historyValuesEqual, normalizeHistoryValue } from '../games-api/src/lib/history.js';
const require = createRequire(import.meta.url);
const subscriptionHelpers = require('../enrich-subscriptions.js');

import { collapseCalendarRows, collapseDisplayRows, collapseGameRows, countWatchedFamilies, displayFamilyKey, gameIdentity, matchesReleaseRange, matchesSearch, normalizeSearch, preferDisplayRow, releaseCertaintyRank, releaseRecordKey, searchRelevance, watchedFamilyKeys } from '../js/search.js';

assert.equal(normalizeSearch('Call of Duty IV™'), 'call of duty 4');
assert.equal(normalizeSearch('Final Fantasy XVI'), 'final fantasy 16');
assert.equal(normalizeTitle('Example II'), normalizeTitle('Example 2'));
assert.equal(normalizeTitle('Final Fantasy XVI'), 'final fantasy 16');
assert.equal(titleScore('Example II', 'Example 2'), 1);
assert.ok(titleQueryVariants('Example II').includes('example 2'));

assert.ok(storefrontTitleScore('Planet Zoo 2', 'Planet Zoo 2') > storefrontTitleScore('Planet Zoo 2', 'Planet Zoo 2: Deluxe Edition'));
assert.ok(storefrontTitleScore('Planet Zoo 2: Deluxe Edition', 'Planet Zoo 2: Deluxe Edition') > storefrontTitleScore('Planet Zoo 2: Deluxe Edition', 'Planet Zoo 2'));
assert.ok(storefrontTitleScore('Gears of War: E-Day', 'Gears of War: E-Day') > storefrontTitleScore('Gears of War: E-Day', 'Gears of War: E-Day Premium Edition'));
assert.ok(storefrontTitleScore('EA Sports FC 27', 'EA Sports FC 27') > storefrontTitleScore('EA Sports FC 27', 'EA SPORTS FC 27 Ultimate Edition'));
assert.ok(storefrontTitleScore('EA Sports FC 27', 'EA SPORTS FC 27 Standard Edition') > storefrontTitleScore('EA Sports FC 27', 'EA SPORTS FC 27 Ultimate Edition'));
assert.ok(storefrontTitleScore('Planet Zoo 2', 'Planet Zoo 2: Deluxe Upgrade Pack') < storefrontTitleScore('Planet Zoo 2', 'Planet Zoo 2'));

assert.equal(subscriptionHelpers.normalizeTitle('Final Fantasy XVI™'), 'final fantasy 16');
assert.equal(subscriptionHelpers.stripStoreSuffix('Yakuza: Like a Dragon PS4 & PS5'), 'Yakuza: Like a Dragon');
assert.ok(subscriptionHelpers.titleVariants('Half-Life® 2').includes('half life 2'));

const subscriptionIndex = subscriptionHelpers.buildUniqueGameIndex([
  { id:'a', name:'Unique Game', aliases:[] },
  { id:'b', name:'Same Name', aliases:[] },
  { id:'c', name:'Same Name', aliases:[] }
]);
assert.equal(subscriptionIndex.unique.get('unique game'), 0);
assert.equal(subscriptionIndex.ambiguous.has('same name'), true);
const subscriptionMatch = subscriptionHelpers.matchCatalogToGames(
  [{ id:'x', title:'Unique Game' }, { id:'y', title:'Same Name' }],
  [{ id:'a', name:'Unique Game', aliases:[] }, { id:'b', name:'Same Name', aliases:[] }, { id:'c', name:'Same Name', aliases:[] }],
  subscriptionIndex
);
assert.equal(subscriptionMatch.byGame.get(0)?.length, 1);
assert.equal(subscriptionMatch.ambiguous, 1);

const microsoftZeroOnly = {
  DisplaySkuAvailabilities:[{ Sku:{ LocalizedProperties:[{ SkuTitle:'Base Game' }] }, Availabilities:[{
    Actions:['Details'],
    OrderManagementData:{ Price:{ CurrencyCode:'CZK', ListPrice:0, MSRP:0 } }
  }]}]
};
assert.equal(microsoftPriceOf(microsoftZeroOnly), null);

const microsoftTrialZero = {
  DisplaySkuAvailabilities:[{ Sku:{ LocalizedProperties:[{ SkuTitle:'Free Trial' }] }, Availabilities:[{
    Actions:['Purchase'],
    OrderManagementData:{ Price:{ CurrencyCode:'CZK', ListPrice:0, MSRP:0, IsFree:true } }
  }]}]
};
assert.equal(microsoftPriceOf(microsoftTrialZero), null);

const microsoftPaid = {
  DisplaySkuAvailabilities:[{ Sku:{ LocalizedProperties:[{ SkuTitle:'Pre-Order' }] }, Availabilities:[{
    Actions:['Purchase'],
    OrderManagementData:{ Price:{ CurrencyCode:'CZK', ListPrice:1799, MSRP:1799 } }
  }]}]
};
assert.equal(microsoftPriceOf(microsoftPaid)?.current, 1799);
assert.equal(microsoftPriceOf(microsoftPaid)?.preorder, true);

const epicTownfall = {
  title:'SILENT HILL: Townfall',
  id:'townfall-base',
  productSlug:'silent-hill-townfall-0cb037/home',
  categories:[{ path:'games' }, { path:'games/edition/base' }],
  price:{ totalPrice:{
    discountPrice:4999,
    originalPrice:4999,
    currencyCode:'USD',
    currencyInfo:{ decimals:2 },
    fmtPrice:{ discountPrice:'$49.99', originalPrice:'$49.99' }
  }}
};
assert.equal(epicIsGameOffer(epicTownfall), true);
assert.equal(epicPriceOf(epicTownfall)?.current, 49.99);
assert.equal(epicPriceOf(epicTownfall)?.currency, 'USD');
assert.equal(epicStoreUrlOf(epicTownfall), 'https://store.epicgames.com/en-US/p/silent-hill-townfall-0cb037');
assert.equal(epicIsGameOffer({ categories:[{ path:'addons' }] }), false);

const xboxBase = { provider:'microsoft', providerId:'BASE', title:'Gears of War: E-Day', price:null, storeUrl:'https://www.xbox.com/cs-CZ/games/store/gears-of-war-e-day/BASE', subscriptions:{ gamePass:true }, rawHints:{} };
const xboxStandard = { provider:'microsoft', providerId:'STD', title:'Gears of War: E-Day Pre-Order', price:{ current:1799, regular:1799, currency:'CZK', preorder:true }, storeUrl:'https://www.xbox.com/cs-CZ/games/store/gears-of-war-e-day-pre-order/STD', subscriptions:{}, rawHints:{} };
const xboxPremium = { provider:'microsoft', providerId:'PREM', title:'Gears of War: E-Day Premium Edition Pre-Order', price:{ current:2599, regular:2599, currency:'CZK', preorder:true }, storeUrl:'https://www.xbox.com/cs-CZ/games/store/gears-of-war-e-day-premium-edition-pre-order/PREM', subscriptions:{}, rawHints:{} };
const xboxUpgrade = { provider:'microsoft', providerId:'UPGRADE', title:'Gears of War: E-Day Premium Edition Upgrade', price:{ current:800, regular:800, currency:'CZK' }, storeUrl:'https://www.xbox.com/cs-CZ/games/store/gears-of-war-e-day-premium-edition-upgrade/UPGRADE', subscriptions:{}, rawHints:{} };
const xboxConsolidated = consolidateMicrosoftSearch('Gears of War: E-Day', [xboxBase, xboxStandard, xboxPremium, xboxUpgrade])[0];
assert.equal(xboxConsolidated.providerId, 'BASE');
assert.equal(xboxConsolidated.storeUrl.includes('xbox.com'), true);
assert.equal(xboxConsolidated.price.current, 1799);
assert.equal(xboxConsolidated.price.from, true);
assert.equal(xboxConsolidated.subscriptions.gamePass, true);
assert.equal(xboxConsolidated.rawHints.xboxOffers.length, 1);
assert.equal(xboxConsolidated.rawHints.xboxOffers.some(offer => offer.providerId === 'UPGRADE'), false);

const xboxWrongSearch = [
  { provider:'microsoft', providerId:'GAMEPASS', title:'Xbox Game Pass Ultimate', price:{ current:499, currency:'CZK' }, subscriptions:{ gamePass:true }, rawHints:{} }
];
assert.deepEqual(consolidateMicrosoftSearch('Gears of War: E-Day', xboxWrongSearch), []);


assert.equal(historyValuesEqual('prices', { microsoft:null }, {}), true);
assert.equal(historyValuesEqual('subscriptions', { gamePass:false }, {}), true);
assert.equal(historyValuesEqual('releaseDates', {}, []), true);
assert.equal(historyValuesEqual('prices', {}, { microsoft:{ current:1799, currency:'CZK' } }), false);
assert.equal(historyValuesEqual('subscriptions', {}, { gamePass:true }), false);
assert.deepEqual(normalizeHistoryValue('prices', { microsoft:null, steam:{ current:69.99, currency:'EUR' } }), {
  steam:{ currency:'EUR', currentText:'', current:69.99, regular:null, isFree:false }
});


assert.equal(normalizeSearch('Pokémon'), 'pokemon');
assert.equal(matchesSearch({ name:'Call of Duty: Modern Warfare', aliases:[], developers:[], publishers:[], series:[] }, 'call warfare'), true);
assert.ok(searchRelevance({ name:'Gears of War', aliases:[], developers:[], publishers:[], series:[] }, 'gears') > 70);

assert.equal(gameIdentity({ id:'legacy-1', igdbId:'42', name:'Same Game' }), 'igdb:42');
assert.equal(gameIdentity({ id:'legacy-1', name:'Same Game' }), 'id:legacy-1');

const duplicateReleaseRows = [
  { game:{ id:'igdb-42', igdbId:'42', name:'Same Game' }, day:'2026-10-01' },
  { game:{ id:'igdb-42', igdbId:'42', name:'Same Game' }, day:'2026-11-01' }
];
assert.equal(collapseGameRows(duplicateReleaseRows).length, 1);

const multiPlatformRows = [
  { game:{ id:'igdb-99', igdbId:'99', name:'Platform Game' }, day:'2026-10-01', platforms:[{ name:'PlayStation 5', abbreviation:'PS5', group:'PS5' }], platformGroups:['PS5'] },
  { game:{ id:'igdb-99', igdbId:'99', name:'Platform Game' }, day:'2026-11-01', platforms:[{ name:'PC (Microsoft Windows)', abbreviation:'PC', group:'PC' }], platformGroups:['PC'] }
];
const collapsedPlatformGame = collapseDisplayRows(multiPlatformRows, (current, candidate) => current.day <= candidate.day ? current : candidate)[0];
assert.equal(collapsedPlatformGame.platforms.length, 2);
assert.deepEqual(new Set(collapsedPlatformGame.platformGroups), new Set(['PS5','PC']));

const reconstructedFamilyCard = collapseDisplayRows(multiPlatformRows, preferDisplayRow)[0];
assert.equal(reconstructedFamilyCard.platforms.length, 2);
assert.deepEqual(new Set(reconstructedFamilyCard.platformGroups), new Set(['PS5','PC']));

const calendarRows = collapseCalendarRows([
  { game:{ id:'igdb-99', igdbId:'99', name:'Platform Game' }, day:'2026-10-01', platforms:[{ name:'PlayStation 5', abbreviation:'PS5', group:'PS5' }], platformGroups:['PS5'] },
  { game:{ id:'igdb-99', igdbId:'99', name:'Platform Game' }, day:'2026-10-01', platforms:[{ name:'PC (Microsoft Windows)', abbreviation:'PC', group:'PC' }], platformGroups:['PC'] },
  { game:{ id:'igdb-99', igdbId:'99', name:'Platform Game' }, day:'2026-11-01', platforms:[{ name:'PC (Microsoft Windows)', abbreviation:'PC', group:'PC' }], platformGroups:['PC'] }
]);
assert.equal(calendarRows.length, 2);
assert.equal(calendarRows.find(row => row.day === '2026-10-01').platforms.length, 2);

assert.notEqual(releaseRecordKey(multiPlatformRows[0]), releaseRecordKey(multiPlatformRows[1]));
const duplicatePs5Record = { ...multiPlatformRows[0], onlineResult:true };
assert.equal(releaseRecordKey(multiPlatformRows[0]), releaseRecordKey(duplicatePs5Record));

const distinctSameTitleRows = [
  { game:{ id:'igdb-42', igdbId:'42', name:'Same Game' }, day:'2026-10-01' },
  { game:{ id:'igdb-43', igdbId:'43', name:'Same Game' }, day:'2026-10-01' }
];
assert.equal(collapseGameRows(distinctSameTitleRows).length, 2);

const reskinRows = [
  { game:{ id:'cats-ar', name:'100 Cats Argentina', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-gr', name:'100 Cats Greece', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-pk', name:'100 Cats Pakistan', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-ph', name:'100 Cats Philippines', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-amsterdam', name:'100 Amsterdam Cats', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-astro', name:'100 Astro Cats', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' },
  { game:{ id:'cats-barcelona', name:'100 Barcelona Cats', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' }
];
assert.equal(collapseDisplayRows(reskinRows).length, 1);

assert.equal(countWatchedFamilies(reskinRows, new Set(['cats-ar','cats-gr'])), 1);
assert.equal(countWatchedFamilies(reskinRows, new Set(['cats-ar','missing-old-id'])), 2);

const watchedCatsFamilies = watchedFamilyKeys(reskinRows, new Set(['cats-ar']));
assert.equal(watchedCatsFamilies.size, 1);
assert.ok(watchedCatsFamilies.has(displayFamilyKey(reskinRows[1])));

const unrelatedNumericRows = [
  ...reskinRows.slice(0, 1),
  { game:{ id:'rooms-100', name:'100 Hidden Rooms', developers:['Same Studio'], contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' }
];
assert.equal(collapseDisplayRows(unrelatedNumericRows).length, 2);

assert.equal(releaseCertaintyRank({ day:'2026-09-25', precision:'day' }), 0);
assert.equal(releaseCertaintyRank({ precision:'month', window:'September 2026' }), 1);
assert.equal(releaseCertaintyRank({ precision:'q4', window:'Q4 2026' }), 2);
assert.equal(releaseCertaintyRank({ precision:'year', window:'2026' }), 3);
assert.equal(releaseCertaintyRank({ precision:'unknown', window:'TBA' }), 4);

const fuzzyRated = { game:{ id:'fuzzy', name:'Family Game', ratingCount:5000, contentType:'Main Game' }, precision:'year', window:'2026', sortDay:'2026-07-01' };
const exactUnrated = { game:{ id:'exact', name:'Family Game', ratingCount:0, contentType:'Main Game' }, day:'2026-10-15', precision:'day', sortDay:'2026-10-15' };
assert.equal(preferDisplayRow(fuzzyRated, exactUnrated), exactUnrated);

const quarterRated = { game:{ id:'q', name:'Family Game', ratingCount:999, contentType:'Main Game' }, precision:'q4', window:'Q4 2026', sortDay:'2026-11-15' };
const monthUnrated = { game:{ id:'m', name:'Family Game', ratingCount:0, contentType:'Main Game' }, precision:'month', window:'October 2026', sortDay:'2026-10-15' };
assert.equal(preferDisplayRow(quarterRated, monthUnrated), monthUnrated);

const septemberRange = { from:'2026-09-01', to:'2026-09-30' };
assert.equal(matchesReleaseRange({ day:'2026-09-18', precision:'day', from:'2026-09-18', to:'2026-09-18' }, septemberRange, 'month'), true);
assert.equal(matchesReleaseRange({ precision:'month', window:'September 2026', from:'2026-09-01', to:'2026-09-30' }, septemberRange, 'month'), true);
assert.equal(matchesReleaseRange({ precision:'q3', window:'Q3 2026', from:'2026-07-01', to:'2026-09-30' }, septemberRange, 'month'), false);
assert.equal(matchesReleaseRange({ precision:'year', window:'2026', from:'2026-01-01', to:'2026-12-31' }, septemberRange, 'month'), false);

assert.deepEqual(releaseBounds({ precision:'year', window:'2027' }), {
  from:'2027-01-01', to:'2027-12-31', sortDay:'2027-07-01'
});
assert.deepEqual(releaseBounds({ precision:'q2', window:'Q2 2027' }), {
  from:'2027-04-01', to:'2027-06-30', sortDay:'2027-05-15'
});
assert.deepEqual(releaseBounds({ precision:'month', window:'September 2026' }), {
  from:'2026-09-01', to:'2026-09-30', sortDay:'2026-09-15'
});
assert.equal(platformGroup('PlayStation 5'), 'PS5');
assert.equal(platformGroup('PlayStation 4'), 'PS4');
assert.equal(platformGroup('Series X|S'), 'Xbox Series');
assert.equal(platformGroup('Xbox Series X|S'), 'Xbox Series');
assert.equal(platformGroup('XONE'), 'Xbox One');
assert.equal(platformGroup('Xbox 360'), 'Xbox 360');
assert.equal(platformGroup('PC (Microsoft Windows)'), 'PC');

const dataset = normalizePayload({
  version:5,
  games:[{
    id:1,
    name:'Fuzzy Game',
    releases:[{ date:null, window:'Q4 2026', precision:'q4', platforms:[{name:'PC'}] }]
  }]
});
assert.equal(dataset.games[0].releases[0].day, null);
assert.equal(dataset.games[0].releases[0].from, '2026-10-01');
assert.equal(dataset.games[0].releases[0].to, '2026-12-31');

const igdbDataset = normalizePayload({ version:5, games:[{
  id:'igdb-preserve',
  igdbId:'348202',
  name:'IGDB Preserve',
  releases:[{ date:'2026-10-01', platforms:['Xbox Series'] }]
}]});
assert.equal(igdbDataset.games[0].igdbId, '348202');

const sameDayDataset = normalizePayload({
  version:5,
  games:[{
    id:'same-day',
    name:'Same Day Game',
    releases:[
      { date:'2026-10-01', platforms:['PS5'] },
      { date:'2026-10-01', platforms:['PC'] }
    ]
  }]
});
const sameDayRows = flattenReleases(sameDayDataset);
assert.equal(sameDayRows.length, 2);
assert.equal(new Set(sameDayRows.map(row => row.key)).size, 2);



const compactControlsSource = readFileSync(new URL('../compact-controls.js', import.meta.url), 'utf8');
assert.equal(compactControlsSource.includes("import('./advanced-features.js')"), false);

const advancedSource = readFileSync(new URL('../advanced-features.js', import.meta.url), 'utf8');
assert.equal(advancedSource.includes("dy >= 88"), false);

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.equal(appSource.includes("dataset.igdbId = String(row.game?.igdbId || '')"), true);

const liveEnrichmentSource = readFileSync(new URL('../live-detail-enrichment.js', import.meta.url), 'utf8');
assert.equal(liveEnrichmentSource.includes('igdbId: currentIgdbId()'), true);

assert.equal(liveEnrichmentSource.includes("games:subscription-updated"), true);
assert.equal(liveEnrichmentSource.includes('cache.get(cacheKey)'), true);

const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
assert.equal(uiSource.includes('card-service-badge'), true);
assert.equal(uiSource.includes('<span>Game Pass</span>'), true);

const appSubscriptionSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.equal(appSubscriptionSource.includes("games:subscription-updated"), true);
assert.equal(appSubscriptionSource.includes('games-calendar-live-subscriptions-v1'), true);

const microsoftProviderSource = readFileSync(new URL('../games-api/src/providers/microsoft.js', import.meta.url), 'utf8');
assert.equal(microsoftProviderSource.includes('productFamilies/Games/products'), true);
assert.equal(microsoftProviderSource.includes('microsoft:search:v4'), true);

const psProviderSource = readFileSync(new URL('../games-api/src/providers/playstation.js', import.meta.url), 'utf8');
assert.equal(psProviderSource.includes('storefrontTitleScore'), true);
assert.equal(psProviderSource.includes('collectProductIds'), true);
assert.equal(psProviderSource.includes('editionCandidates'), true);
assert.equal(psProviderSource.includes('playstation:html-search:v2'), true);

const nintendoProviderSource = readFileSync(new URL('../games-api/src/providers/nintendo.js', import.meta.url), 'utf8');
assert.equal(nintendoProviderSource.includes('storefrontTitleScore'), true);
assert.equal(nintendoProviderSource.includes('700100'), true);
assert.equal(nintendoProviderSource.includes('nintendo:search:v3'), true);


const priceUiSource = readFileSync(new URL('../live-detail-enrichment.js', import.meta.url), 'utf8');
assert.equal(priceUiSource.includes("new Intl.NumberFormat('cs-CZ'"), true);

const moduleSources = [
  '../compact-controls.js',
  '../advanced-features.js',
  '../badge-filter-controls.js',
  '../filter-section-accordion.js',
  '../detail-gesture-fix.js',
  '../live-detail-enrichment.js',
  '../release-tracker.js',
  '../js/app.js'
];
for (const source of moduleSources) {
  const url = new URL(source, import.meta.url);
  const text = readFileSync(url, 'utf8');
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    assert.equal(existsSync(new URL(specifier, url)), true, `Missing local import ${specifier} from ${source}`);
  }
}

const compactPayload = JSON.parse(readFileSync(new URL('../games-index.json', import.meta.url), 'utf8'));
assert.equal(compactPayload.compact, true);
const compactDataset = normalizePayload(compactPayload);
assert.equal(compactDataset.games.length, compactPayload.games.length);
assert.ok(compactDataset.games.every(game => Array.isArray(game.releases)));

console.log('Smoke tests passed.');
