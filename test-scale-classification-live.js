#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');

const INPUT = process.env.GAMES_INPUT || 'games.json';
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const API_ROOTS = [
  'https://130.61.49.108/games-api',
  'https://130.61.49.108:8443/games-api'
];
const BATCH_SIZE = 500;

const MAJOR_COMPANIES = [
  'microsoft', 'xbox game studios', 'bethesda softworks', 'zenimax media',
  'activision', 'activision blizzard', 'blizzard entertainment',
  'sony interactive entertainment', 'playstation studios', 'nintendo',
  'electronic arts', 'ea sports', 'ubisoft', 'take two interactive',
  'take two interactive software', 'rockstar games', '2k', 'sega',
  'square enix', 'capcom', 'bandai namco entertainment', 'bandai namco studios',
  'konami', 'warner bros games', 'wb games', 'koei tecmo games',
  'cd projekt', 'cd projekt red', 'epic games', 'netease games', 'tencent games'
];

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const uniq = values => [...new Set((values || []).filter(Boolean))];

function knownScale(value = '') {
  const v = normalize(value);
  if (v === 'aaa' || v.includes('triple a')) return 'AAA';
  if (v.includes('indie')) return 'Indie';
  if (v.includes('mensi') || v.includes('small')) return 'Menší titul';
  return '';
}

function richness(game = {}) {
  return [
    game.cover, game.summary, Number(game.rating || 0) > 0, Number(game.ratingCount || 0) > 0,
    (game.screenshots || []).length, game.trailerId || game.trailerUrl,
    (game.developers || []).length, (game.publishers || []).length, game.steamId
  ].reduce((score, value) => score + (value ? 1 : 0), 0);
}

function dedupeGames(games = []) {
  const out = [];
  const byIdentity = new Map();
  for (const game of games) {
    const identity = game.igdbId ? `igdb:${game.igdbId}` : `id:${game.id}`;
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, out.length);
      out.push(game);
      continue;
    }
    const index = byIdentity.get(identity);
    if (richness(game) > richness(out[index])) out[index] = game;
  }
  return out;
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function releaseUpperBound(release = {}) {
  const precision = normalize(release.precision || release.datePrecision || (release.date || release.day ? 'day' : 'unknown'));
  const day = String(release.date || release.day || '').slice(0, 10);
  if (day && precision === 'day') return day;

  const window = String(release.window || release.releaseWindow || release.label || '').trim();
  const year = Number(window.match(/\b(20\d{2})\b/)?.[1] || day.slice(0, 4) || 0);
  if (!year) return null;

  if (precision === 'year') return `${year}-12-31`;
  const q = Number((precision.match(/^q([1-4])$/) || window.match(/\bQ([1-4])\b/i))?.[1] || 0);
  if (q) {
    const month = q * 3;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }

  const monthMatch = window.match(/\b(0?[1-9]|1[0-2])[\/. -](20\d{2})\b/);
  const month = Number(monthMatch?.[1] || (precision === 'month' ? day.slice(5, 7) : 0) || 0);
  if (month) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }
  return day || null;
}

function isUpcoming(game = {}) {
  const releases = Array.isArray(game.releases) ? game.releases : [];
  if (!releases.length) return false;
  return releases.some(release => {
    const upper = releaseUpperBound(release);
    return !upper || upper >= TODAY;
  });
}

function sizeRange(value = '') {
  const text = String(value || '').replace(/,/g, '');
  const nums = [...text.matchAll(/\d+/g)].map(match => Number(match[0])).filter(Number.isFinite);
  if (!nums.length) return null;
  if (/\+|more|over|above/i.test(text)) return { min:nums[0], max:Infinity };
  if (nums.length >= 2) return { min:Math.min(nums[0], nums[1]), max:Math.max(nums[0], nums[1]) };
  return { min:nums[0], max:nums[0] };
}

function majorCompany(value = '') {
  const name = normalize(value);
  if (!name) return false;
  return MAJOR_COMPANIES.some(major => name === major || name.startsWith(`${major} `));
}

function platformFamily(platform) {
  const text = normalize(typeof platform === 'string' ? platform : `${platform?.abbreviation || ''} ${platform?.name || ''}`);
  if (!text) return '';
  if (/playstation|\bps[345]\b/.test(text)) return 'PlayStation';
  if (/xbox/.test(text)) return 'Xbox';
  if (/nintendo|switch/.test(text)) return 'Nintendo';
  if (/windows|linux|mac|\bpc\b/.test(text)) return 'PC';
  if (/meta|oculus|steamvr|vision pro|\bvr\b/.test(text)) return 'VR';
  return 'Other';
}

function catalogPlatformFamilies(game = {}) {
  const platforms = (game.releases || []).flatMap(release => release.platforms || []);
  return new Set(platforms.map(platformFamily).filter(Boolean));
}

async function postBatch(ids) {
  let lastError = null;
  for (const root of API_ROOTS) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${root}/igdb/catalog-batch?refresh=1`, {
          method:'POST',
          headers:{ Accept:'application/json', 'content-type':'application/json' },
          body:JSON.stringify({ ids })
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`${root} HTTP ${response.status}: ${text.slice(0, 300)}`);
        const payload = JSON.parse(text);
        return Array.isArray(payload?.items) ? payload.items : [];
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Live GameS API unavailable');
}

async function fetchLiveSignals(games) {
  const ids = uniq(games.map(game => Number(game.igdbId)).filter(id => Number.isInteger(id) && id > 0));
  const byId = new Map();
  let batchNumber = 0;
  for (const batch of chunks(ids, BATCH_SIZE)) {
    batchNumber += 1;
    process.stderr.write(`IGDB live batch ${batchNumber}/${Math.ceil(ids.length / BATCH_SIZE)} (${batch.length})\n`);
    const items = await postBatch(batch);
    for (const item of items) {
      const id = Number(item?.providerId || item?.igdbId || item?.id);
      if (Number.isInteger(id) && id > 0) byId.set(id, item);
    }
  }
  return byId;
}

function classify(game, signal) {
  const existing = knownScale(game.scale);
  if (existing) return { scale:existing, confidence:'existing', score:null, reasons:['existing scale'] };

  const genres = uniq([...(game.genres || []), ...(signal?.genres || [])].map(item => typeof item === 'string' ? item : item?.name));
  if (genres.some(genre => normalize(genre) === 'indie')) {
    return { scale:'Indie', confidence:'high', score:null, reasons:['explicit Indie genre'] };
  }
  if (!signal) return { scale:'Nezařazeno', confidence:'low', score:0, reasons:['no live IGDB row'] };

  const involved = Array.isArray(signal.involvedCompanies)
    ? signal.involvedCompanies
    : Array.isArray(signal.rawHints?.involvedCompanies) ? signal.rawHints.involvedCompanies : [];
  const publishers = involved.filter(item => item?.publisher);
  const developers = involved.filter(item => item?.developer);

  const names = involved.flatMap(item => [item?.name, item?.parent]).filter(Boolean);
  const publisherNames = publishers.flatMap(item => [item?.name, item?.parent]).filter(Boolean);
  const developerNames = developers.flatMap(item => [item?.name, item?.parent]).filter(Boolean);
  const majorPublisher = publisherNames.some(majorCompany);
  const majorDeveloper = developerNames.some(majorCompany);
  const anyMajor = names.some(majorCompany);

  const companyRanges = involved.flatMap(item => [sizeRange(item?.companySize), sizeRange(item?.parentCompanySize)]).filter(Boolean);
  const developerRanges = developers.map(item => sizeRange(item?.companySize)).filter(Boolean);
  const maxCompanySize = companyRanges.reduce((best, range) => Math.max(best, Number.isFinite(range.max) ? range.max : 1_000_000), 0);
  const largestDeveloper = developerRanges.reduce((best, range) => Math.max(best, Number.isFinite(range.max) ? range.max : 1_000_000), 0);

  const hypes = Number(signal.hypes || signal.rawHints?.hypes || 0) || 0;
  const series = uniq([...(game.series || []), ...(signal.series || [])]);
  const franchise = series.length > 0;
  const families = new Set([
    ...catalogPlatformFamilies(game),
    ...((signal.platforms || []).map(platformFamily).filter(Boolean))
  ]);
  families.delete('Other');

  let score = 0;
  const reasons = [];
  if (majorPublisher) { score += 4; reasons.push('major publisher/parent'); }
  else if (majorDeveloper) { score += 3; reasons.push('major developer/parent'); }
  if (maxCompanySize >= 1000) { score += 3; reasons.push('company/parent size >=1000'); }
  else if (maxCompanySize >= 500) { score += 2; reasons.push('company/parent size >=500'); }
  if (hypes >= 1000) { score += 3; reasons.push(`hypes ${hypes}`); }
  else if (hypes >= 250) { score += 2; reasons.push(`hypes ${hypes}`); }
  else if (hypes >= 50) { score += 1; reasons.push(`hypes ${hypes}`); }
  if (franchise) { score += 1; reasons.push('series/franchise'); }
  if (families.size >= 3) { score += 1; reasons.push(`${families.size} platform families`); }

  const institutional = anyMajor || maxCompanySize >= 500;
  if (score >= 6 && institutional) {
    return { scale:'AAA', confidence:score >= 8 ? 'high' : 'medium', score, hypes, reasons };
  }

  const hasKnownDeveloperSize = developerRanges.length > 0;
  const noLargeCompany = !anyMajor && maxCompanySize < 500;
  if (hasKnownDeveloperSize && largestDeveloper <= 50 && noLargeCompany && hypes < 50 && families.size <= 2) {
    return {
      scale:'Menší titul', confidence:'high', score, hypes,
      reasons:[`developer size <=50`, `hypes ${hypes}`, `${families.size} platform families`, 'no major/large parent']
    };
  }

  return { scale:'Nezařazeno', confidence:'low', score, hypes, reasons:reasons.length ? reasons : ['insufficient evidence'] };
}

function countScales(rows, key) {
  const out = { AAA:0, Indie:0, 'Menší titul':0, 'Nezařazeno':0 };
  for (const row of rows) {
    const scale = key === 'before' ? row.before : row.after.scale;
    out[scale] = (out[scale] || 0) + 1;
  }
  return out;
}

function summarize(rows) {
  const unknownBefore = rows.filter(row => row.before === 'Nezařazeno');
  const moved = unknownBefore.filter(row => row.after.scale !== 'Nezařazeno');
  return {
    games:rows.length,
    current:countScales(rows, 'before'),
    proposed:countScales(rows, 'after'),
    movedFromUnknown:{
      total:moved.length,
      coveragePct:Number((moved.length / Math.max(1, unknownBefore.length) * 100).toFixed(1)),
      AAA:moved.filter(row => row.after.scale === 'AAA').length,
      Indie:moved.filter(row => row.after.scale === 'Indie').length,
      'Menší titul':moved.filter(row => row.after.scale === 'Menší titul').length,
      remainingUnknown:unknownBefore.filter(row => row.after.scale === 'Nezařazeno').length
    }
  };
}

function samples(rows, scale, limit = 30) {
  return rows
    .filter(row => row.before === 'Nezařazeno' && row.after.scale === scale)
    .sort((a, b) => (b.after.score || 0) - (a.after.score || 0) || (b.after.hypes || 0) - (a.after.hypes || 0) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(row => ({
      name:row.name,
      igdbId:row.igdbId || null,
      confidence:row.after.confidence,
      score:row.after.score,
      hypes:row.after.hypes || 0,
      reasons:row.after.reasons,
      companies:(row.signal?.involvedCompanies || []).map(item => ({
        name:item.name || '', developer:Boolean(item.developer), publisher:Boolean(item.publisher),
        companySize:item.companySize || '', parent:item.parent || '', parentCompanySize:item.parentCompanySize || ''
      })).slice(0, 8)
    }));
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  const games = dedupeGames(Array.isArray(payload.games) ? payload.games : []);
  const signals = await fetchLiveSignals(games);

  const rows = games.map(game => {
    const igdbId = Number(game.igdbId || 0);
    const signal = signals.get(igdbId) || null;
    return {
      id:String(game.id || ''), igdbId:igdbId ? String(igdbId) : '', name:String(game.name || ''),
      before:knownScale(game.scale) || 'Nezařazeno',
      after:classify(game, signal), signal, upcoming:isUpcoming(game)
    };
  });

  const signalItems = [...signals.values()];
  const companyRows = signalItems.flatMap(item => item.involvedCompanies || []);
  const report = {
    generatedAt:new Date().toISOString(),
    sourceGeneratedAt:payload.generatedAt || null,
    today:TODAY,
    liveApiSignals:{
      requestedIgdbIds:uniq(games.map(game => Number(game.igdbId)).filter(id => Number.isInteger(id) && id > 0)).length,
      rowsFetched:signals.size,
      gamesWithHypes:signalItems.filter(item => Number(item.hypes || 0) > 0).length,
      companyRows:companyRows.length,
      developerSizeKnown:companyRows.filter(item => item.developer && item.companySize).length,
      publisherSizeKnown:companyRows.filter(item => item.publisher && item.companySize).length,
      parentKnown:companyRows.filter(item => item.parent).length,
      parentSizeKnown:companyRows.filter(item => item.parentCompanySize).length
    },
    scopes:{
      all:summarize(rows),
      upcoming:summarize(rows.filter(row => row.upcoming))
    },
    upcomingSamples:{
      AAA:samples(rows.filter(row => row.upcoming), 'AAA'),
      'Menší titul':samples(rows.filter(row => row.upcoming), 'Menší titul'),
      Indie:samples(rows.filter(row => row.upcoming), 'Indie', 10)
    },
    notes:[
      'Dry run only: games.json, games-index.json and UI are not modified.',
      'Existing non-empty scale values are preserved.',
      'Signals are fetched from the deployed GameS IGDB provider, which uses server-side IGDB credentials.',
      'Indie requires an explicit Indie genre.',
      'AAA requires score >=6 and a major/large-company signal.',
      'Menší titul requires known developer size <=50, no major/large company, hypes <50 and <=2 platform families.'
    ]
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
