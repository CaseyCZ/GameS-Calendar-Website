#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REPORT = process.env.SCALE_REPORT || 'scale-classification-report.json';
const GAMES = process.env.GAMES_INPUT || 'games.json';
const OUT = process.env.AUDIT_OUT || 'scale-classification-audit.json';

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const payload = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
const today = String(report.today || new Date().toISOString().slice(0, 10));

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

function gameKey(game = {}) {
  return String(game.igdbId || game.providerId || game.id || '');
}

const games = Array.isArray(payload.games) ? payload.games : [];
const byIgdb = new Map();
for (const game of games) {
  const key = String(game.igdbId || '');
  if (key && !byIgdb.has(key)) byIgdb.set(key, game);
}

function releaseAudit(game = {}) {
  const releases = Array.isArray(game.releases) ? game.releases : [];
  const dated = [];
  for (const release of releases) {
    const date = String(release.date || release.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    dated.push({
      date,
      platforms:(release.platforms || []).map(p => typeof p === 'string' ? p : (p?.abbreviation || p?.name || '')).filter(Boolean)
    });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date));
  const past = dated.filter(x => x.date < today);
  const future = dated.filter(x => x.date >= today);
  const earliest = dated[0]?.date || null;
  const nextFuture = future[0]?.date || null;
  let oldToNewDays = null;
  if (earliest && nextFuture && earliest < nextFuture) {
    oldToNewDays = Math.round((Date.parse(`${nextFuture}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86400000);
  }
  return {
    earliest,
    latestPast:past.at(-1)?.date || null,
    nextFuture,
    pastReleaseCount:past.length,
    futureReleaseCount:future.length,
    oldToNewDays,
    oldRerelease:Boolean(oldToNewDays && oldToNewDays >= 180),
    futurePlatforms:[...new Set(future.flatMap(x => x.platforms))]
  };
}

function companyAudit(candidate) {
  const companies = Array.isArray(candidate.companies) ? candidate.companies : [];
  const devs = companies.filter(c => c.developer);
  const pubs = companies.filter(c => c.publisher);
  const directMajor = companies.some(c => isMajor(c.name));
  const parentMajor = companies.some(c => isMajor(c.parent));
  const directMajorDeveloper = devs.some(c => isMajor(c.name));
  const directMajorPublisher = pubs.some(c => isMajor(c.name));
  const majorDeveloperViaParent = devs.some(c => isMajor(c.parent));
  const majorPublisherViaParent = pubs.some(c => isMajor(c.parent));
  const maxDeveloperSize = devs.reduce((m, c) => Math.max(m, sizeMax(c.companySize)), 0);
  const maxPublisherSize = pubs.reduce((m, c) => Math.max(m, sizeMax(c.companySize)), 0);
  const maxKnownSize = companies.reduce((m, c) => Math.max(m, sizeMax(c.companySize), sizeMax(c.parentCompanySize)), 0);
  const unknownPublisher = pubs.some(c => !c.companySize && !c.parentCompanySize);
  const unknownDeveloper = devs.some(c => !c.companySize && !c.parentCompanySize);
  const publisherUnknownParent = pubs.some(c => c.parent && !c.parentCompanySize && !isMajor(c.parent));
  return {
    directMajor, parentMajor, directMajorDeveloper, directMajorPublisher,
    majorDeveloperViaParent, majorPublisherViaParent,
    maxDeveloperSize, maxPublisherSize, maxKnownSize,
    unknownPublisher, unknownDeveloper, publisherUnknownParent,
    developerCount:devs.length, publisherCount:pubs.length
  };
}

function platformFamilyCount(candidate) {
  const hit = (candidate.reasons || []).map(String).map(x => x.match(/^(\d+) platform families$/)).find(Boolean);
  return hit ? Number(hit[1]) : null;
}

function titleFlags(name = '') {
  const n = normalize(name);
  const nonStandalone = /\b(dlc|expansion|season pass|soundtrack|demo|prologue|beta|test server|content pack|skin pack|upgrade pack)\b/.test(n);
  const rerelease = /\b(remaster|remastered|remake|enhanced|definitive|complete edition|anniversary|collection|redux|reloaded|retold|revival|directors cut|director s cut|goty|game of the year)\b/.test(n);
  return { nonStandalone, rerelease };
}

function auditAAA(candidate) {
  const game = byIgdb.get(String(candidate.igdbId || '')) || {};
  const release = releaseAudit(game);
  const company = companyAudit(candidate);
  const title = titleFlags(candidate.name);
  const flags = [];
  let risk = 0;
  let likelyFalse = false;

  if (title.nonStandalone) { flags.push('title looks like DLC/expansion/demo/pack rather than a standalone game'); risk += 5; likelyFalse = true; }
  if (candidate.confidence === 'medium') { flags.push('only medium AAA confidence'); risk += 2; }
  if (Number(candidate.score || 0) <= 6) { flags.push('AAA score is exactly at the threshold'); risk += 2; }
  else if (Number(candidate.score || 0) === 7) { flags.push('AAA score is close to the threshold'); risk += 1; }
  if (Number(candidate.hypes || 0) === 0) { flags.push('no IGDB hype signal'); risk += 1; }
  else if (Number(candidate.hypes || 0) < 10) { flags.push('very low IGDB hype signal'); risk += 1; }
  if (!company.directMajor && company.parentMajor) { flags.push('major-company evidence comes only through a parent company'); risk += 2; }
  if (company.maxDeveloperSize > 0 && company.maxDeveloperSize <= 50 && (company.directMajorPublisher || company.majorPublisherViaParent)) {
    flags.push('small developer with AAA evidence dominated by publisher/parent'); risk += 2;
  }
  if (company.developerCount === 0) { flags.push('no developer row in the IGDB company evidence'); risk += 1; }
  if (title.rerelease) { flags.push('title explicitly looks like remake/remaster/re-release'); risk += 1; }
  if (release.oldRerelease) { flags.push(`older title has a new/future release (${release.oldToNewDays} days after earliest dated release)`); risk += 1; }

  if (!likelyFalse && Number(candidate.score || 0) <= 6 && Number(candidate.hypes || 0) < 10
      && !company.directMajorDeveloper && company.maxDeveloperSize < 500) {
    flags.push('weak threshold-only AAA case without strong developer evidence');
    likelyFalse = true;
    risk += 2;
  }

  let status = 'keep';
  if (likelyFalse) status = 'likely_false_positive';
  else if (risk >= 4) status = 'manual_review_high';
  else if (risk >= 2) status = 'manual_review';

  return { status, risk, flags, release, company, gameKey:gameKey(game) || null };
}

function auditSmall(candidate) {
  const game = byIgdb.get(String(candidate.igdbId || '')) || {};
  const release = releaseAudit(game);
  const company = companyAudit(candidate);
  const title = titleFlags(candidate.name);
  const families = platformFamilyCount(candidate);
  const flags = [];
  let risk = 0;
  let likelyFalse = false;

  if (title.nonStandalone) { flags.push('title looks like DLC/expansion/demo/pack rather than a standalone game'); risk += 5; likelyFalse = true; }
  if (company.directMajor || company.parentMajor) { flags.push('major company/parent still appears in company evidence'); risk += 5; likelyFalse = true; }
  if (company.maxKnownSize >= 500) { flags.push('known company/parent size is 500+ despite small-title classification'); risk += 5; likelyFalse = true; }
  if (company.developerCount === 0) { flags.push('no developer row in company evidence'); risk += 4; likelyFalse = true; }
  if (company.maxDeveloperSize === 0) { flags.push('developer size cannot be verified from candidate evidence'); risk += 2; }
  if (company.publisherUnknownParent) { flags.push('publisher has a parent of unknown size'); risk += 2; }
  if (Number(candidate.hypes || 0) >= 20) { flags.push(`relatively high hype for small-title rule (${candidate.hypes})`); risk += 2; }
  else if (Number(candidate.hypes || 0) >= 10) { flags.push(`borderline hype for small-title rule (${candidate.hypes})`); risk += 1; }
  if (families === 2) { flags.push('available on two platform families'); risk += 1; }
  if (title.rerelease) { flags.push('title explicitly looks like remake/remaster/re-release'); risk += 1; }
  if (release.oldRerelease) { flags.push(`older title has a new/future release (${release.oldToNewDays} days after earliest dated release)`); risk += 1; }

  let status = 'keep';
  if (likelyFalse) status = 'likely_false_positive';
  else if (risk >= 4) status = 'manual_review_high';
  else if (risk >= 2) status = 'manual_review';

  return { status, risk, flags, release, company, platformFamilies:families, gameKey:gameKey(game) || null };
}

function auditList(candidates, fn) {
  return (candidates || []).map(candidate => ({ ...candidate, audit:fn(candidate) }));
}

function statusCounts(rows) {
  const out = { keep:0, manual_review:0, manual_review_high:0, likely_false_positive:0 };
  for (const row of rows) out[row.audit.status] = (out[row.audit.status] || 0) + 1;
  return out;
}

const aaa = auditList(report.upcomingSamples?.AAA || [], auditAAA);
const small = auditList(report.upcomingSamples?.['Menší titul'] || [], auditSmall);

const result = {
  generatedAt:new Date().toISOString(),
  sourceReportGeneratedAt:report.generatedAt || null,
  today,
  expectedCandidateCounts:{
    AAA:Number(report.scopes?.upcoming?.movedFromUnknown?.AAA || 0),
    'Menší titul':Number(report.scopes?.upcoming?.movedFromUnknown?.['Menší titul'] || 0)
  },
  auditedCandidateCounts:{ AAA:aaa.length, 'Menší titul':small.length },
  complete:{
    AAA:aaa.length === Number(report.scopes?.upcoming?.movedFromUnknown?.AAA || 0),
    'Menší titul':small.length === Number(report.scopes?.upcoming?.movedFromUnknown?.['Menší titul'] || 0)
  },
  statusCounts:{ AAA:statusCounts(aaa), 'Menší titul':statusCounts(small) },
  flagged:{
    AAA:aaa.filter(x => x.audit.status !== 'keep').map(x => ({ name:x.name, igdbId:x.igdbId, status:x.audit.status, risk:x.audit.risk, flags:x.audit.flags })),
    'Menší titul':small.filter(x => x.audit.status !== 'keep').map(x => ({ name:x.name, igdbId:x.igdbId, status:x.audit.status, risk:x.audit.risk, flags:x.audit.flags }))
  },
  candidates:{ AAA:aaa, 'Menší titul':small },
  notes:[
    'Audit only; it does not change games.json, games-index.json, classification or UI.',
    'Every candidate is checked for weak threshold evidence, company/parent contradictions, re-release patterns and non-standalone title patterns.',
    'manual_review is a risk flag, not an automatic rejection. likely_false_positive is intentionally conservative and requires a strong contradiction or non-standalone pattern.'
  ]
};

fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ complete:result.complete, auditedCandidateCounts:result.auditedCandidateCounts, statusCounts:result.statusCounts, flagged:result.flagged }, null, 2));
