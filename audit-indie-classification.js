#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REPORT = process.env.SCALE_REPORT || 'scale-classification-report.json';
const GAMES = process.env.GAMES_INPUT || 'games.json';
const OUT = process.env.INDIE_AUDIT_OUT || 'indie-classification-audit.json';

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const payload = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
const candidates = Array.isArray(report.upcomingSamples?.Indie) ? report.upcomingSamples.Indie : [];
const games = Array.isArray(payload.games) ? payload.games : [];

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const MAJOR = [
  'microsoft', 'xbox game studios', 'bethesda softworks', 'zenimax media',
  'activision', 'activision blizzard', 'blizzard entertainment',
  'sony', 'sony interactive entertainment', 'playstation studios', 'nintendo',
  'electronic arts', 'ea sports', 'ubisoft', 'ubisoft entertainment',
  'take two interactive', 'take two interactive software', 'rockstar games', '2k',
  'sega', 'square enix', 'capcom', 'bandai namco entertainment', 'bandai namco studios',
  'konami', 'warner bros games', 'wb games', 'koei tecmo games',
  'cd projekt', 'cd projekt red', 'epic games', 'netease', 'netease games',
  'tencent', 'tencent games', 'tencent holdings', 'amazon games', 'krafton'
];

function isMajor(name = '') {
  const n = normalize(name);
  return Boolean(n) && MAJOR.some(m => n === m || n.startsWith(`${m} `));
}

function sizeMax(value = '') {
  const text = String(value || '').replace(/,/g, '');
  const nums = [...text.matchAll(/\d+/g)].map(m => Number(m[0])).filter(Number.isFinite);
  if (!nums.length) return 0;
  if (/\+|more|over|above/i.test(text)) return 1_000_000;
  return nums.length >= 2 ? Math.max(nums[0], nums[1]) : nums[0];
}

function isExtraGameType(value = '') {
  const type = normalize(value);
  if (!type || type.includes('standalone expansion')) return false;
  return /\b(dlc|addon|add on|expansion|bundle|episode|season|update|pack)\b/.test(type);
}

const byIgdb = new Map();
for (const game of games) {
  const id = String(game.igdbId || '');
  if (id && !byIgdb.has(id)) byIgdb.set(id, game);
}

function catalogHasIndie(game = {}) {
  return (game.genres || []).some(item => normalize(typeof item === 'string' ? item : item?.name) === 'indie');
}

function companyStats(row) {
  const companies = Array.isArray(row.companies) ? row.companies : [];
  const devs = companies.filter(c => c.developer);
  const pubs = companies.filter(c => c.publisher);
  const majorDirect = companies.some(c => isMajor(c.name));
  const majorParent = companies.some(c => isMajor(c.parent));
  const devSizes = devs.map(c => sizeMax(c.companySize)).filter(Boolean);
  const maxDev = devSizes.length ? Math.max(...devSizes) : 0;
  const knownTinyDev = devSizes.length > 0 && maxDev <= 50;
  const knownLargeDev = maxDev >= 500;
  const majorPublisher = pubs.some(c => isMajor(c.name) || isMajor(c.parent));
  return {
    developerCount:devs.length,
    publisherCount:pubs.length,
    maxDeveloperSize:maxDev,
    developerSizeKnown:devSizes.length > 0,
    knownTinyDev,
    knownLargeDev,
    majorDirect,
    majorParent,
    majorPublisher,
    anyMajor:majorDirect || majorParent
  };
}

const rows = candidates.map(row => {
  const game = byIgdb.get(String(row.igdbId || '')) || {};
  const company = companyStats(row);
  const hypes = Number(row.hypes || 0) || 0;
  return {
    name:row.name || '',
    igdbId:row.igdbId || null,
    hypes,
    gameType:row.gameType || null,
    catalogIndie:catalogHasIndie(game),
    liveOnlyIndie:!catalogHasIndie(game),
    extraType:isExtraGameType(row.gameType),
    company
  };
});

function count(fn) { return rows.filter(fn).length; }
function pct(n) { return Number((n / Math.max(1, rows.length) * 100).toFixed(1)); }

const hype = {
  zero:count(r => r.hypes === 0),
  oneToNine:count(r => r.hypes >= 1 && r.hypes <= 9),
  tenToFortyNine:count(r => r.hypes >= 10 && r.hypes <= 49),
  fiftyTo249:count(r => r.hypes >= 50 && r.hypes <= 249),
  twoFiftyPlus:count(r => r.hypes >= 250)
};

const popularity = {
  under10:hype.zero + hype.oneToNine,
  under50:hype.zero + hype.oneToNine + hype.tenToFortyNine,
  fiftyPlus:hype.fiftyTo249 + hype.twoFiftyPlus
};

const source = {
  alreadyIndieInCatalog:count(r => r.catalogIndie),
  addedOnlyByLiveIgdbGenre:count(r => r.liveOnlyIndie)
};

const company = {
  developerSizeKnown:count(r => r.company.developerSizeKnown),
  developerSizeUnknown:count(r => !r.company.developerSizeKnown),
  tinyDeveloperKnownLe50:count(r => r.company.knownTinyDev),
  largeDeveloperKnownGe500:count(r => r.company.knownLargeDev),
  majorCompanyOrParent:count(r => r.company.anyMajor),
  majorPublisherOrParent:count(r => r.company.majorPublisher),
  noDeveloperRow:count(r => r.company.developerCount === 0)
};

const extras = rows.filter(r => r.extraType);
const suspiciousMajor = rows.filter(r => r.company.anyMajor)
  .sort((a,b) => b.hypes - a.hypes || a.name.localeCompare(b.name))
  .slice(0, 60);
const tinyLowHype = rows.filter(r => r.company.knownTinyDev && r.hypes < 50)
  .sort((a,b) => a.hypes - b.hypes || a.name.localeCompare(b.name))
  .slice(0, 60);

const result = {
  generatedAt:new Date().toISOString(),
  scope:'Newly inferred upcoming Indie candidates only (previously Nezařazeno). Existing Indie rows are not reclassified by this audit.',
  expectedNewIndie:Number(report.scopes?.upcoming?.movedFromUnknown?.Indie || 0),
  auditedNewIndie:rows.length,
  complete:rows.length === Number(report.scopes?.upcoming?.movedFromUnknown?.Indie || 0),
  currentUpcomingIndie:Number(report.scopes?.upcoming?.current?.Indie || 0),
  proposedUpcomingIndie:Number(report.scopes?.upcoming?.proposed?.Indie || 0),
  source,
  hypes:{
    ...hype,
    under10:popularity.under10,
    under10Pct:pct(popularity.under10),
    under50:popularity.under50,
    under50Pct:pct(popularity.under50),
    fiftyPlus:popularity.fiftyPlus,
    fiftyPlusPct:pct(popularity.fiftyPlus)
  },
  gameTypes:{
    extras:extras.length,
    extrasPct:pct(extras.length),
    extrasByType:Object.fromEntries([...new Set(extras.map(r => r.gameType || 'Unknown'))]
      .sort().map(type => [type, extras.filter(r => (r.gameType || 'Unknown') === type).length]))
  },
  company:{
    ...company,
    tinyDeveloperKnownLe50Pct:pct(company.tinyDeveloperKnownLe50),
    majorCompanyOrParentPct:pct(company.majorCompanyOrParent)
  },
  examples:{
    extras:extras.slice(0, 40),
    majorCompanyOverlap:suspiciousMajor,
    tinyLowHype:tinyLowHype
  },
  conclusionHints:[
    'Indie is currently assigned before the small-title rule, so an explicit Indie genre always wins over Menší titul.',
    'IGDB/Steam popularity is not part of the Indie rule; any explicit Indie genre qualifies regardless of hypes.',
    'The audit separates catalog Indie tags from the small number added only by live IGDB genre data.'
  ]
};

fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
