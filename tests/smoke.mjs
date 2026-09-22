import assert from 'node:assert/strict';
import { normalizePayload, platformGroup, releaseBounds } from '../js/data.js';
import { matchesSearch, normalizeSearch, searchRelevance } from '../js/search.js';

assert.equal(normalizeSearch('Call of Duty IV™'), 'call of duty 4');
assert.equal(normalizeSearch('Pokémon'), 'pokemon');
assert.equal(matchesSearch({ name:'Call of Duty: Modern Warfare', aliases:[], developers:[], publishers:[], series:[] }, 'call warfare'), true);
assert.ok(searchRelevance({ name:'Gears of War', aliases:[], developers:[], publishers:[], series:[] }, 'gears') > 70);

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

console.log('Smoke tests passed.');
