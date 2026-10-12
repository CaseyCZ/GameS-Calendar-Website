#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REPORT = process.env.SCALE_REPORT || 'scale-classification-report.json';
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

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

function candidateEvidence(row = {}) {
  const companies = Array.isArray(row.companies) ? row.companies : [];
  const developers = companies.filter(company => company?.developer);
  return {
    directMajorDeveloper:developers.some(company => isMajor(company?.name)),
    maxDeveloperSize:developers.reduce((max, company) => Math.max(max, sizeMax(company?.companySize)), 0),
    developerCount:developers.length
  };
}

function isWeakThresholdAAA(row = {}) {
  const score = Number(row.score || 0);
  const hypes = Number(row.hypes || 0);
  const evidence = candidateEvidence(row);
  return {
    reject:score === 6 && hypes < 10 && !evidence.directMajorDeveloper && evidence.maxDeveloperSize < 500,
    score,
    hypes,
    ...evidence
  };
}

function adjustUpcoming(excludedCount) {
  if (!excludedCount) return;
  const scope = report.scopes?.upcoming;
  if (!scope) return;

  if (scope.proposed) {
    scope.proposed.AAA = Math.max(0, Number(scope.proposed.AAA || 0) - excludedCount);
    scope.proposed['Nezařazeno'] = Number(scope.proposed['Nezařazeno'] || 0) + excludedCount;
  }

  if (scope.movedFromUnknown) {
    scope.movedFromUnknown.AAA = Math.max(0, Number(scope.movedFromUnknown.AAA || 0) - excludedCount);
    scope.movedFromUnknown.total = Math.max(0, Number(scope.movedFromUnknown.total || 0) - excludedCount);
    scope.movedFromUnknown.remainingUnknown = Number(scope.movedFromUnknown.remainingUnknown || 0) + excludedCount;
    const currentUnknown = Number(scope.current?.['Nezařazeno'] || 0);
    scope.movedFromUnknown.coveragePct = Number((scope.movedFromUnknown.total / Math.max(1, currentUnknown) * 100).toFixed(1));
  }
}

const source = Array.isArray(report.upcomingSamples?.AAA) ? report.upcomingSamples.AAA : [];
const kept = [];
const excluded = [];

for (const row of source) {
  const evidence = isWeakThresholdAAA(row);
  if (evidence.reject) {
    excluded.push({
      name:row.name || '',
      igdbId:row.igdbId || null,
      gameType:row.gameType || null,
      previousScore:row.score ?? null,
      previousConfidence:row.confidence ?? null,
      hypes:Number(row.hypes || 0),
      directMajorDeveloper:evidence.directMajorDeveloper,
      maxDeveloperSize:evidence.maxDeveloperSize,
      developerCount:evidence.developerCount,
      reason:'score 6 + hypes <10 + no direct major developer + known developer size below 500 (or unavailable)'
    });
  } else {
    kept.push(row);
  }
}

report.upcomingSamples.AAA = kept;
adjustUpcoming(excluded.length);

const protectedNames = [
  'Grand Theft Auto VI',
  'Fable',
  'Call of Duty: Modern Warfare 4',
  'Gears of War: E-Day'
];
const keptNames = new Set(kept.map(row => String(row.name || '')));
const protectedChecks = Object.fromEntries(protectedNames.map(name => [name, keptNames.has(name)]));

report.aaaEvidenceGate = {
  applied:true,
  rule:'Reject only threshold AAA cases with score=6, hypes<10, no direct major developer and developer size <500 or unavailable.',
  upcoming:{ before:source.length, after:kept.length, excluded:excluded.length },
  protectedChecks,
  excluded
};

report.notes ||= [];
report.notes.push('Test-only AAA evidence gate applied after content-type gate. Weak threshold-only AAA cases are returned to Nezařazeno for this dry run.');

fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.aaaEvidenceGate, null, 2));
