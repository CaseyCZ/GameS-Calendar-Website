#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');

const INPUT = process.env.GAMES_INPUT || 'games.json';
const IGDB_API = 'https://api.igdb.com/v4';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const CLIENT_ID = String(process.env.IGDB_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.IGDB_CLIENT_SECRET || '').trim();
const BATCH = 500;
const GAP_MS = 300;

const MAJOR_COMPANIES = new Set([
  'microsoft','xbox game studios','bethesda softworks','zenimax media','activision','activision blizzard','blizzard entertainment',
  'sony interactive entertainment','playstation studios','nintendo','electronic arts','ea sports','ubisoft','take two interactive',
  'rockstar games','2k','sega','square enix','capcom','bandai namco entertainment','bandai namco studios','konami',
  'warner bros games','wb games','koei tecmo games','cd projekt','cd projekt red','epic games','netease games','tencent games'
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uniq = values => [...new Set((values || []).filter(Boolean))];
const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function knownScale(value = '') {
  const v = normalize(value);
  if (v === 'aaa' || v.includes('triple a')) return 'AAA';
  if (v.includes('indie')) return 'Indie';
  if (v.includes('mensi') || v.includes('small')) return 'Menší titul';
  return '';
}

function richness(game = {}) {
  return [game.cover, game.summary, Number(game.rating || 0) > 0, Number(game.ratingCount || 0) > 0,
    (game.screenshots || []).length, game.trailerId || game.trailerUrl,
    (game.developers || []).length, (game.publishers || []).length, game.steamId]
    .reduce((score, value) => score + (value ? 1 : 0), 0);
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
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function token() {
  const body = new URLSearchParams({ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, grant_type:'client_credentials' });
  const response = await fetch(TOKEN_URL, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body });
  if (!response.ok) throw new Error(`Twitch token HTTP ${response.status}`);
  const json = await response.json();
  if (!json.access_token) throw new Error('Twitch token missing');
  return json.access_token;
}

async function igdbRequest(endpoint, query, accessToken) {
  const response = await fetch(`${IGDB_API}/${endpoint}`, {
    method:'POST',
    headers:{ 'Client-ID':CLIENT_ID, Authorization:`Bearer ${accessToken}`, Accept:'application/json', 'content-type':'text/plain' },
    body:query
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`IGDB ${endpoint} HTTP ${response.status}: ${text.slice(0,300)}`);
  await sleep(GAP_MS);
  return JSON.parse(text);
}

async function fetchCompanySizes(accessToken) {
  const rows = await igdbRequest('company_sizes', 'fields id,name; limit 500;', accessToken);
  return new Map(rows.map(row => [Number(row.id), String(row.name || '')]));
}

async function fetchCompanies(ids, accessToken, target = new Map()) {
  const pending = uniq(ids.map(Number).filter(Number.isInteger)).filter(id => !target.has(id));
  for (const batch of chunks(pending, BATCH)) {
    if (!batch.length) continue;
    const rows = await igdbRequest('companies', `fields id,name,parent,company_size; where id = (${batch.join(',')}); limit ${batch.length};`, accessToken);
    rows.forEach(row => target.set(Number(row.id), row));
  }
  return target;
}

async function fetchSignals(games) {
  if (!CLIENT_ID || !CLIENT_SECRET) return { available:false, byGame:new Map(), companies:new Map(), sizes:new Map(), reason:'IGDB secrets unavailable' };
  const accessToken = await token();
  const ids = uniq(games.map(game => Number(game.igdbId)).filter(id => Number.isInteger(id) && id > 0));
  const byGame = new Map();
  const companyIds = [];

  for (const batch of chunks(ids, BATCH)) {
    const fields = [
      'id','hypes','genres.name','platforms.name','platforms.abbreviation','collections.name','franchises.name',
      'involved_companies.developer','involved_companies.publisher','involved_companies.company'
    ].join(',');
    const rows = await igdbRequest('games', `fields ${fields}; where id = (${batch.join(',')}); limit ${batch.length};`, accessToken);
    for (const row of rows) {
      byGame.set(Number(row.id), row);
      for (const involved of row.involved_companies || []) {
        const companyId = Number(typeof involved.company === 'object' ? involved.company?.id : involved.company);
        if (Number.isInteger(companyId) && companyId > 0) companyIds.push(companyId);
      }
    }
  }

  const companies = await fetchCompanies(companyIds, accessToken);
  for (let depth = 0; depth < 3; depth += 1) {
    const parentIds = uniq([...companies.values()].map(row => Number(typeof row.parent === 'object' ? row.parent?.id : row.parent)).filter(id => Number.isInteger(id) && id > 0));
    const missing = parentIds.filter(id => !companies.has(id));
    if (!missing.length) break;
    await fetchCompanies(missing, accessToken, companies);
  }
  const sizes = await fetchCompanySizes(accessToken);
  return { available:true, byGame, companies, sizes };
}

function sizeRange(name = '') {
  const text = String(name || '').replace(/,/g, '');
  const nums = [...text.matchAll(/\d+/g)].map(match => Number(match[0])).filter(Number.isFinite);
  if (!nums.length) return null;
  if (/\+|more|over|above/i.test(text)) return { min:nums[0], max:Infinity };
  if (nums.length >= 2) return { min:Math.min(nums[0], nums[1]), max:Math.max(nums[0], nums[1]) };
  return { min:nums[0], max:nums[0] };
}

function platformFamily(platform = {}) {
  const text = normalize(`${platform.abbreviation || ''} ${platform.name || ''}`);
  if (/playstation|\bps[345]\b/.test(text)) return 'PlayStation';
  if (/xbox/.test(text)) return 'Xbox';
  if (/nintendo|switch/.test(text)) return 'Nintendo';
  if (/windows|linux|mac|pc/.test(text)) return 'PC';
  if (/meta|oculus|steamvr|vision pro|vr/.test(text)) return 'VR';
  return text || '';
}

function companyChain(companyId, companies, sizes) {
  const chain = [];
  const seen = new Set();
  let id = Number(companyId);
  for (let depth = 0; depth < 4 && Number.isInteger(id) && id > 0 && !seen.has(id); depth += 1) {
    seen.add(id);
    const company = companies.get(id);
    if (!company) break;
    const sizeName = sizes.get(Number(typeof company.company_size === 'object' ? company.company_size?.id : company.company_size)) || '';
    chain.push({ id, name:String(company.name || ''), size:sizeName, sizeRange:sizeRange(sizeName) });
    id = Number(typeof company.parent === 'object' ? company.parent?.id : company.parent);
  }
  return chain;
}

function classify(game, signal, companies, sizes) {
  const current = knownScale(game.scale);
  if (current) return { scale:current, confidence:'existing', score:null, reasons:['existing scale'] };

  const genres = uniq([...(game.genres || []), ...((signal?.genres || []).map(item => item?.name).filter(Boolean))]);
  if (genres.some(genre => normalize(genre) === 'indie')) {
    return { scale:'Indie', confidence:'high', score:null, reasons:['IGDB/catalog genre Indie'] };
  }

  if (!signal) return { scale:'Nezařazeno', confidence:'low', score:0, reasons:['no IGDB signal row'] };

  const involved = (signal.involved_companies || []).map(item => {
    const id = Number(typeof item.company === 'object' ? item.company?.id : item.company);
    return { id, developer:Boolean(item.developer), publisher:Boolean(item.publisher), chain:companyChain(id, companies, sizes) };
  }).filter(item => Number.isInteger(item.id) && item.id > 0);

  const allCompanies = involved.flatMap(item => item.chain);
  const publisherCompanies = involved.filter(item => item.publisher).flatMap(item => item.chain);
  const developerCompanies = involved.filter(item => item.developer).flatMap(item => item.chain);
  const isMajor = company => MAJOR_COMPANIES.has(normalize(company?.name));
  const majorPublisher = publisherCompanies.some(isMajor);
  const majorDeveloper = developerCompanies.some(isMajor);
  const maxCompany = allCompanies.reduce((best, company) => {
    const range = company.sizeRange;
    if (!range) return best;
    const numeric = Number.isFinite(range.max) ? range.max : 1000000;
    return numeric > best ? numeric : best;
  }, 0);
  const hypes = Number(signal.hypes || 0) || 0;
  const franchise = Boolean((signal.franchises || []).length || (signal.collections || []).length || (game.series || []).length);
  const families = new Set((signal.platforms || []).map(platformFamily).filter(Boolean));

  let score = 0;
  const reasons = [];
  if (majorPublisher) { score += 4; reasons.push('major publisher/parent'); }
  else if (majorDeveloper) { score += 3; reasons.push('major developer/parent'); }
  if (maxCompany >= 1000) { score += 3; reasons.push('company size >=1000'); }
  else if (maxCompany >= 500) { score += 2; reasons.push('company size >=500'); }
  if (hypes >= 1000) { score += 3; reasons.push(`hypes ${hypes}`); }
  else if (hypes >= 250) { score += 2; reasons.push(`hypes ${hypes}`); }
  else if (hypes >= 50) { score += 1; reasons.push(`hypes ${hypes}`); }
  if (franchise) { score += 1; reasons.push('franchise/collection'); }
  if (families.size >= 3) { score += 1; reasons.push(`${families.size} platform families`); }

  const institutional = majorPublisher || majorDeveloper || maxCompany >= 500;
  if (score >= 6 && institutional) {
    return { scale:'AAA', confidence:score >= 8 ? 'high' : 'medium', score, reasons };
  }

  const developerRanges = developerCompanies.map(company => company.sizeRange).filter(Boolean);
  const hasKnownDeveloperSize = developerRanges.length > 0;
  const largestDeveloper = developerRanges.reduce((best, range) => {
    const numeric = Number.isFinite(range.max) ? range.max : 1000000;
    return Math.max(best, numeric);
  }, 0);
  const noMajor = !majorPublisher && !majorDeveloper;
  if (hasKnownDeveloperSize && largestDeveloper <= 50 && noMajor && hypes < 50 && families.size <= 2) {
    return {
      scale:'Menší titul', confidence:'high', score,
      reasons:[`developer size <=50`, `hypes ${hypes}`, `${families.size || 0} platform families`, 'no major company']
    };
  }

  return { scale:'Nezařazeno', confidence:'low', score, reasons:reasons.length ? reasons : ['insufficient evidence'] };
}

function countScales(items) {
  const out = { AAA:0, Indie:0, 'Menší titul':0, 'Nezařazeno':0 };
  for (const item of items) out[item] = (out[item] || 0) + 1;
  return out;
}

function topSamples(rows, scale, limit = 20) {
  return rows.filter(row => row.after.scale === scale && row.before === 'Nezařazeno')
    .sort((a, b) => (b.after.score || 0) - (a.after.score || 0) || Number(b.hypes || 0) - Number(a.hypes || 0) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(row => ({ id:row.id, igdbId:row.igdbId || null, name:row.name, confidence:row.after.confidence, score:row.after.score, hypes:row.hypes || 0, reasons:row.after.reasons }));
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  const games = dedupeGames(Array.isArray(payload.games) ? payload.games : []);
  const beforeLabels = games.map(game => knownScale(game.scale) || 'Nezařazeno');
  const signals = await fetchSignals(games);

  const rows = games.map(game => {
    const signal = signals.byGame.get(Number(game.igdbId));
    const after = classify(game, signal, signals.companies, signals.sizes);
    return {
      id:String(game.id || ''), igdbId:String(game.igdbId || ''), name:String(game.name || ''),
      before:knownScale(game.scale) || 'Nezařazeno', after,
      hypes:Number(signal?.hypes || 0) || 0
    };
  });

  const afterLabels = rows.map(row => row.after.scale);
  const movedFromUnknown = rows.filter(row => row.before === 'Nezařazeno' && row.after.scale !== 'Nezařazeno');
  const unknownTotal = rows.filter(row => row.before === 'Nezařazeno').length;
  const igdbRows = rows.filter(row => row.igdbId && signals.byGame.has(Number(row.igdbId))).length;
  const report = {
    generatedAt:new Date().toISOString(),
    sourceGeneratedAt:payload.generatedAt || null,
    games:games.length,
    igdbSignals:{ available:signals.available, reason:signals.reason || null, gamesWithIgdbId:rows.filter(row => row.igdbId).length, rowsFetched:igdbRows, companyRows:signals.companies.size, companySizeRows:signals.sizes.size },
    current:countScales(beforeLabels),
    proposed:countScales(afterLabels),
    movedFromUnknown:{
      total:movedFromUnknown.length,
      coveragePct:Number((movedFromUnknown.length / Math.max(1, unknownTotal) * 100).toFixed(1)),
      AAA:movedFromUnknown.filter(row => row.after.scale === 'AAA').length,
      Indie:movedFromUnknown.filter(row => row.after.scale === 'Indie').length,
      'Menší titul':movedFromUnknown.filter(row => row.after.scale === 'Menší titul').length,
      remainingUnknown:rows.filter(row => row.before === 'Nezařazeno' && row.after.scale === 'Nezařazeno').length
    },
    samples:{
      AAA:topSamples(rows, 'AAA'),
      Indie:topSamples(rows, 'Indie'),
      'Menší titul':topSamples(rows, 'Menší titul')
    },
    notes:[
      'Dry run only: does not modify games.json, games-index.json or UI.',
      'Existing non-empty scale values are preserved.',
      'Indie requires an explicit Indie genre.',
      'AAA requires score >=6 plus a major/large-company signal.',
      'Menší titul requires known developer size <=50, no major company, hypes <50 and <=2 platform families.'
    ]
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
