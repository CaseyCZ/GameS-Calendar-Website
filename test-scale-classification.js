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

function catalogPlatformFamilies(game = {}) {
  return new Set((game.releases || []).flatMap(release => release.platforms || []).map(platformFamily).filter(Boolean));
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

function explicitIndie(game, signal = null) {
  const genres = uniq([...(game.genres || []), ...((signal?.genres || []).map(item => item?.name).filter(Boolean))]);
  return genres.some(genre => normalize(genre) === 'indie');
}

function classifySafe(game) {
  const current = knownScale(game.scale);
  if (current) return { scale:current, confidence:'existing', score:null, reasons:['existing scale'] };
  if (explicitIndie(game)) return { scale:'Indie', confidence:'high', score:null, reasons:['catalog genre Indie'] };
  return { scale:'Nezařazeno', confidence:'low', score:0, reasons:['insufficient evidence in current catalog'] };
}

function classifyCatalogHeuristic(game) {
  const safe = classifySafe(game);
  if (safe.scale !== 'Nezařazeno') return safe;

  const publishers = (game.publishers || []).map(normalize);
  const developers = (game.developers || []).map(normalize);
  const majorPublisher = publishers.some(name => MAJOR_COMPANIES.has(name));
  const majorDeveloper = developers.some(name => MAJOR_COMPANIES.has(name));
  const ratingCount = Number(game.ratingCount || 0) || 0;
  const franchise = Boolean((game.series || []).length);
  const families = catalogPlatformFamilies(game);

  let score = 0;
  const reasons = [];
  if (majorPublisher) { score += 4; reasons.push('major publisher'); }
  else if (majorDeveloper) { score += 3; reasons.push('major developer'); }
  if (ratingCount >= 1000) { score += 2; reasons.push(`ratingCount ${ratingCount}`); }
  else if (ratingCount >= 100) { score += 1; reasons.push(`ratingCount ${ratingCount}`); }
  if (franchise) { score += 1; reasons.push('series/franchise'); }
  if (families.size >= 3) { score += 1; reasons.push(`${families.size} platform families`); }

  if ((majorPublisher || majorDeveloper) && score >= 5) {
    return { scale:'AAA', confidence:score >= 7 ? 'high' : 'candidate', score, reasons };
  }
  return { scale:'Nezařazeno', confidence:'low', score, reasons:reasons.length ? reasons : ['insufficient evidence'] };
}

function classifyRich(game, signal, companies, sizes) {
  const current = knownScale(game.scale);
  if (current) return { scale:current, confidence:'existing', score:null, reasons:['existing scale'] };
  if (explicitIndie(game, signal)) return { scale:'Indie', confidence:'high', score:null, reasons:['IGDB/catalog genre Indie'] };
  if (!signal) return classifyCatalogHeuristic(game);

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
    return Math.max(best, Number.isFinite(range.max) ? range.max : 1000000);
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
  if (score >= 6 && institutional) return { scale:'AAA', confidence:score >= 8 ? 'high' : 'medium', score, reasons };

  const developerRanges = developerCompanies.map(company => company.sizeRange).filter(Boolean);
  const largestDeveloper = developerRanges.reduce((best, range) => Math.max(best, Number.isFinite(range.max) ? range.max : 1000000), 0);
  if (developerRanges.length && largestDeveloper <= 50 && !majorPublisher && !majorDeveloper && hypes < 50 && families.size <= 2) {
    return { scale:'Menší titul', confidence:'high', score, reasons:['developer size <=50', `hypes ${hypes}`, `${families.size || 0} platform families`, 'no major company'] };
  }

  return { scale:'Nezařazeno', confidence:'low', score, reasons:reasons.length ? reasons : ['insufficient evidence'] };
}

function countScales(rows, modelKey) {
  const out = { AAA:0, Indie:0, 'Menší titul':0, 'Nezařazeno':0 };
  for (const row of rows) {
    const value = modelKey === 'current' ? row.before : row[modelKey].scale;
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function summarize(rows, modelKey) {
  const current = countScales(rows, 'current');
  const proposed = countScales(rows, modelKey);
  const unknownRows = rows.filter(row => row.before === 'Nezařazeno');
  const moved = unknownRows.filter(row => row[modelKey].scale !== 'Nezařazeno');
  return {
    games:rows.length,
    current,
    proposed,
    movedFromUnknown:{
      total:moved.length,
      coveragePct:Number((moved.length / Math.max(1, unknownRows.length) * 100).toFixed(1)),
      AAA:moved.filter(row => row[modelKey].scale === 'AAA').length,
      Indie:moved.filter(row => row[modelKey].scale === 'Indie').length,
      'Menší titul':moved.filter(row => row[modelKey].scale === 'Menší titul').length,
      remainingUnknown:unknownRows.filter(row => row[modelKey].scale === 'Nezařazeno').length
    }
  };
}

function topSamples(rows, modelKey, scale, limit = 15) {
  return rows.filter(row => row.before === 'Nezařazeno' && row[modelKey].scale === scale)
    .sort((a, b) => (b[modelKey].score || 0) - (a[modelKey].score || 0) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(row => ({ name:row.name, igdbId:row.igdbId || null, confidence:row[modelKey].confidence, score:row[modelKey].score, reasons:row[modelKey].reasons }));
}

async function main() {
  const [{ normalizePayload, flattenReleases, todayLocal }, { collapseDisplayRows, preferDisplayRow }] = await Promise.all([
    import('./js/data.js'), import('./js/search.js')
  ]);
  const payload = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  const dataset = normalizePayload(payload);
  const signals = await fetchSignals(dataset.games);

  const modelForGame = new Map();
  for (const game of dataset.games) {
    const signal = signals.byGame.get(Number(game.igdbId));
    modelForGame.set(game, {
      before:knownScale(game.scale) || 'Nezařazeno',
      safe:classifySafe(game),
      catalog:classifyCatalogHeuristic(game),
      rich:classifyRich(game, signal, signals.companies, signals.sizes)
    });
  }

  const toReportRow = row => {
    const models = modelForGame.get(row.game);
    return {
      id:String(row.game.id || ''), igdbId:String(row.game.igdbId || ''), name:String(row.game.name || ''),
      before:models.before, safe:models.safe, catalog:models.catalog, rich:models.rich
    };
  };

  const allRows = collapseDisplayRows(flattenReleases(dataset), preferDisplayRow).map(toReportRow);
  const today = todayLocal();
  const upcomingBaseRows = flattenReleases(dataset).filter(row => !(row.to || row.day) || (row.to || row.day) >= today);
  const upcomingRows = collapseDisplayRows(upcomingBaseRows, preferDisplayRow).map(toReportRow);

  const report = {
    generatedAt:new Date().toISOString(),
    sourceGeneratedAt:dataset.generatedAt || null,
    today,
    igdbSignals:{
      available:signals.available,
      reason:signals.reason || null,
      gamesWithIgdbId:dataset.games.filter(game => game.igdbId).length,
      rowsFetched:signals.byGame.size,
      companyRows:signals.companies.size,
      companySizeRows:signals.sizes.size
    },
    scopes:{
      all:{
        safe:summarize(allRows, 'safe'),
        catalogHeuristic:summarize(allRows, 'catalog'),
        richIgdb:summarize(allRows, 'rich')
      },
      upcoming:{
        safe:summarize(upcomingRows, 'safe'),
        catalogHeuristic:summarize(upcomingRows, 'catalog'),
        richIgdb:summarize(upcomingRows, 'rich')
      }
    },
    upcomingSamples:{
      catalogAAA:topSamples(upcomingRows, 'catalog', 'AAA'),
      safeIndie:topSamples(upcomingRows, 'safe', 'Indie'),
      richAAA:topSamples(upcomingRows, 'rich', 'AAA'),
      richSmall:topSamples(upcomingRows, 'rich', 'Menší titul')
    },
    notes:[
      'Dry run only: games.json, games-index.json and UI are untouched.',
      'safe model changes only explicit Indie genre and preserves existing scale.',
      'catalogHeuristic additionally marks AAA candidates from current publisher/developer, series, rating-count and platform data.',
      'richIgdb adds hypes, company size and parent-company evidence when IGDB credentials are available.',
      'Menší titul is intentionally not inferred without company-size evidence.'
    ]
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
