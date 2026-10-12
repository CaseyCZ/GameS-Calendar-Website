#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REPORT = process.env.SCALE_REPORT || 'scale-classification-report.json';
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function gameTypeOf(row = {}) {
  return row.gameType ?? row.signal?.gameType ?? row.signal?.rawHints?.gameType ?? null;
}

function isExtraGameType(value = '') {
  const type = normalize(value);
  if (!type) return false;
  if (type.includes('standalone expansion')) return false;
  return /\b(dlc|addon|add on|expansion|bundle|episode|season|update|pack)\b/.test(type);
}

function filterScale(scale) {
  const rows = Array.isArray(report.upcomingSamples?.[scale]) ? report.upcomingSamples[scale] : [];
  const kept = [];
  const excluded = [];
  for (const row of rows) {
    const gameType = gameTypeOf(row);
    if (isExtraGameType(gameType)) {
      excluded.push({
        name:row.name || '',
        igdbId:row.igdbId || null,
        gameType:gameType || null,
        previousScale:scale,
        previousScore:row.score ?? null,
        previousConfidence:row.confidence ?? null,
        reason:'excluded by content-type gate before production-scale classification'
      });
    } else {
      kept.push(row);
    }
  }
  report.upcomingSamples[scale] = kept;
  return { kept, excluded };
}

function adjustUpcoming(scale, excludedCount) {
  if (!excludedCount) return;
  const scope = report.scopes?.upcoming;
  if (!scope) return;

  if (scope.proposed) {
    scope.proposed[scale] = Math.max(0, Number(scope.proposed[scale] || 0) - excludedCount);
    scope.proposed['Nezařazeno'] = Number(scope.proposed['Nezařazeno'] || 0) + excludedCount;
  }

  if (scope.movedFromUnknown) {
    scope.movedFromUnknown[scale] = Math.max(0, Number(scope.movedFromUnknown[scale] || 0) - excludedCount);
    scope.movedFromUnknown.total = Math.max(0, Number(scope.movedFromUnknown.total || 0) - excludedCount);
    scope.movedFromUnknown.remainingUnknown = Number(scope.movedFromUnknown.remainingUnknown || 0) + excludedCount;
    const currentUnknown = Number(scope.current?.['Nezařazeno'] || 0);
    scope.movedFromUnknown.coveragePct = Number((scope.movedFromUnknown.total / Math.max(1, currentUnknown) * 100).toFixed(1));
  }
}

const aaa = filterScale('AAA');
const small = filterScale('Menší titul');
adjustUpcoming('AAA', aaa.excluded.length);
adjustUpcoming('Menší titul', small.excluded.length);

report.contentTypeGate = {
  applied:true,
  rule:'Exclude DLC/add-on/expansion/bundle/episode/season/update/pack before production-scale classification; Standalone Expansion remains eligible.',
  upcoming:{
    AAA:{ before:aaa.kept.length + aaa.excluded.length, after:aaa.kept.length, excluded:aaa.excluded.length },
    'Menší titul':{ before:small.kept.length + small.excluded.length, after:small.kept.length, excluded:small.excluded.length }
  },
  excluded:{ AAA:aaa.excluded, 'Menší titul':small.excluded }
};

report.notes ||= [];
report.notes.push('Test-only content-type gate applied before AAA/small-title audit. Extras are returned to Nezařazeno for this dry run.');

fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.contentTypeGate, null, 2));
