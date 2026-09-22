import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePayload, platformGroup, releaseBounds } from '../js/data.js';
import { collapseGameRows, gameIdentity, matchesSearch, normalizeSearch, searchRelevance } from '../js/search.js';

assert.equal(normalizeSearch('Call of Duty IV™'), 'call of duty 4');
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

const distinctSameTitleRows = [
  { game:{ id:'igdb-42', igdbId:'42', name:'Same Game' }, day:'2026-10-01' },
  { game:{ id:'igdb-43', igdbId:'43', name:'Same Game' }, day:'2026-10-01' }
];
assert.equal(collapseGameRows(distinctSameTitleRows).length, 2);

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



const compactPayload = JSON.parse(readFileSync(new URL('../games-index.json', import.meta.url), 'utf8'));
assert.equal(compactPayload.compact, true);
const compactDataset = normalizePayload(compactPayload);
assert.equal(compactDataset.games.length, compactPayload.games.length);
assert.ok(compactDataset.games.every(game => Array.isArray(game.releases)));

console.log('Smoke tests passed.');
