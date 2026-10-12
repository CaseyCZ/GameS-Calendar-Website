#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REPORT = process.env.SCALE_REPORT || 'scale-classification-report.json';
const AUDIT = process.env.AUDIT_OUT || 'scale-classification-audit.json';

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const sourceByScale = {
  AAA:new Map((report.upcomingSamples?.AAA || []).map(x => [String(x.igdbId || ''), x])),
  'Menší titul':new Map((report.upcomingSamples?.['Menší titul'] || []).map(x => [String(x.igdbId || ''), x]))
};

function addFlag(row, text, risk = 0) {
  row.audit.flags ||= [];
  if (!row.audit.flags.includes(text)) row.audit.flags.push(text);
  row.audit.risk = Number(row.audit.risk || 0) + risk;
}

function promote(row, status) {
  const rank = { keep:0, manual_review:1, manual_review_high:2, likely_false_positive:3 };
  if ((rank[status] || 0) > (rank[row.audit.status] || 0)) row.audit.status = status;
}

for (const scale of ['AAA', 'Menší titul']) {
  for (const row of audit.candidates?.[scale] || []) {
    const source = sourceByScale[scale].get(String(row.igdbId || '')) || {};
    const gameType = source.gameType ?? row.gameType ?? null;
    row.gameType = gameType;
    const type = normalize(gameType);
    const title = normalize(row.name);

    const standaloneExpansion = type.includes('standalone expansion');
    const nonStandaloneType = !standaloneExpansion && /\b(dlc|addon|expansion|bundle|episode|season)\b/.test(type);
    const rereleaseType = /\b(remake|remaster|port|expanded game)\b/.test(type);
    const obviousAddonTitle = /\b(treasure map|vip membership|welcome pack|additional chapter|expansion pass|dlc character|season pass)\b/.test(title)
      || /\byear \d+\s+[a-z0-9]/.test(title);

    if (nonStandaloneType) {
      addFlag(row, `IGDB game type is non-standalone: ${gameType}`, 5);
      promote(row, 'likely_false_positive');
    } else if (standaloneExpansion) {
      addFlag(row, `IGDB game type is standalone expansion: ${gameType}`, 2);
      promote(row, 'manual_review');
    }

    if (obviousAddonTitle) {
      addFlag(row, 'title pattern indicates add-on/DLC content', 5);
      promote(row, 'likely_false_positive');
    }

    if (rereleaseType) {
      addFlag(row, `IGDB game type is re-release variant: ${gameType}`, 1);
      promote(row, 'manual_review');
    }
  }
}

function statusCounts(rows) {
  const out = { keep:0, manual_review:0, manual_review_high:0, likely_false_positive:0 };
  for (const row of rows || []) out[row.audit.status] = (out[row.audit.status] || 0) + 1;
  return out;
}

function flagged(rows) {
  return (rows || []).filter(x => x.audit.status !== 'keep').map(x => ({
    name:x.name, igdbId:x.igdbId, gameType:x.gameType || null,
    status:x.audit.status, risk:x.audit.risk, flags:x.audit.flags
  }));
}

audit.statusCounts = {
  AAA:statusCounts(audit.candidates?.AAA),
  'Menší titul':statusCounts(audit.candidates?.['Menší titul'])
};
audit.flagged = {
  AAA:flagged(audit.candidates?.AAA),
  'Menší titul':flagged(audit.candidates?.['Menší titul'])
};
audit.notes ||= [];
audit.notes.push('Second audit pass uses IGDB gameType. DLC/addon/expansion/bundle/episode/season rows are treated as likely false positives for the AAA/small-title filter; remake/remaster/port rows remain review items.');

fs.writeFileSync(AUDIT, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ statusCounts:audit.statusCounts, flagged:audit.flagged }, null, 2));
