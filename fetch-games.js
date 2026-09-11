#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const MONTHS_PAST = Math.max(0, Number(process.env.IGDB_MONTHS_PAST ?? 6));
const MONTHS_FUTURE = Math.max(1, Number(process.env.IGDB_MONTHS_FUTURE ?? 18));
const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const API = 'https://api.igdb.com/v4';
const REQUEST_DELAY_MS = 280;
const MAX_RETRIES = 4;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Chybí TWITCH_CLIENT_ID nebo TWITCH_CLIENT_SECRET.');
  process.exit(1);
}
if (typeof fetch !== 'function') {
  console.error('❌ Tento skript vyžaduje Node.js 18+ (globální fetch).');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pad = n => String(n).padStart(2, '0');
const dayString = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

async function getToken() {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('client_secret', CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`Twitch OAuth HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('Twitch OAuth nevrátil access_token.');
  return data.access_token;
}

async function igdbRequest(endpoint, body, token, attempt = 0) {
  await sleep(REQUEST_DELAY_MS);
  const response = await fetch(`${API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    },
    body
  });

  if (response.ok) return response.json();
  const detail = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    const wait = Math.min(8000, 700 * (2 ** attempt)) + Math.floor(Math.random() * 250);
    console.warn(`⚠️ IGDB HTTP ${response.status}; opakuji za ${wait} ms…`);
    await sleep(wait);
    return igdbRequest(endpoint, body, token, attempt + 1);
  }
  throw new Error(`IGDB ${endpoint} HTTP ${response.status}: ${detail.slice(0, 500)}`);
}

async function discoverPlatforms(token) {
  if (process.env.IGDB_PLATFORM_IDS) {
    const ids = process.env.IGDB_PLATFORM_IDS.split(',').map(Number).filter(Number.isInteger);
    if (!ids.length) throw new Error('IGDB_PLATFORM_IDS neobsahuje žádné platné ID.');
    console.log(`🎮 Používám platformy z IGDB_PLATFORM_IDS: ${ids.join(', ')}`);
    return ids;
  }

  try {
    const platforms = await igdbRequest('platforms', 'fields id,name,abbreviation; sort id asc; limit 500;', token);
    const primaryNames = new Set([
      'PC (Microsoft Windows)', 'PlayStation 5', 'Xbox Series X|S',
      'Nintendo Switch', 'Nintendo Switch 2'
    ]);
    const isWanted = platform => {
      const name = String(platform.name || '');
      return primaryNames.has(name) || /SteamVR|Quest|Rift|PlayStation VR|Virtual Reality/i.test(name);
    };
    const selected = platforms.filter(isWanted);
    if (!selected.length) throw new Error('nepodařilo se najít cílové platformy');
    console.log('🎮 Platformy: ' + selected.map(p => `${p.name} (${p.id})`).join(', '));
    return [...new Set(selected.map(p => p.id))];
  } catch (error) {
    console.warn(`⚠️ Dynamické načtení platforem selhalo (${error.message}). Používám základní fallback.`);
    return [6, 167, 169, 130];
  }
}

function monthBounds(offset) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0, 23, 59, 59));
  return {
    from,
    to,
    fromTs: Math.floor(from.getTime() / 1000),
    toTs: Math.floor(to.getTime() / 1000)
  };
}

const RELEASE_FIELDS = [
  'id','date','human',
  'platform.id','platform.name','platform.abbreviation',
  'game.id','game.name','game.slug','game.summary','game.storyline','game.url',
  'game.cover.url','game.cover.image_id',
  'game.genres.name',
  'game.involved_companies.developer','game.involved_companies.publisher','game.involved_companies.company.name',
  'game.rating','game.rating_count','game.total_rating','game.total_rating_count',
  'game.videos.video_id','game.videos.name',
  'game.websites.url','game.websites.type',
  'game.external_games.url','game.external_games.uid','game.external_games.external_game_source'
].join(',');

async function fetchMonth(offset, platformIds, token) {
  const { from, fromTs, toTs } = monthBounds(offset);
  const all = [];
  for (let pageOffset = 0; ; pageOffset += 500) {
    const body = `
      fields ${RELEASE_FIELDS};
      where date >= ${fromTs} & date <= ${toTs}
        & game.game_type = 0
        & game.version_parent = null
        & game.parent_game = null
        & platform = (${platformIds.join(',')});
      sort date asc;
      limit 500;
      offset ${pageOffset};
    `;
    const batch = await igdbRequest('release_dates', body, token);
    all.push(...batch);
    if (batch.length < 500) break;
  }
  console.log(`📅 ${from.getUTCFullYear()}-${pad(from.getUTCMonth()+1)}: ${all.length} release záznamů`);
  return all;
}

function typeId(value) {
  if (typeof value === 'number') return value;
  return Number(value?.id ?? value?.value ?? value) || 0;
}

function firstLink(items, predicate) {
  return (items || []).find(predicate)?.url || '';
}

function makeLinks(game) {
  const websites = game.websites || [];
  const external = game.external_games || [];
  const official = firstLink(websites, item => typeId(item.type) === 1);
  const websiteYoutube = firstLink(websites, item => typeId(item.type) === 9);
  const websiteSteam = firstLink(websites, item => typeId(item.type) === 13);
  const reddit = firstLink(websites, item => typeId(item.type) === 14);
  const websiteEpic = firstLink(websites, item => typeId(item.type) === 16);
  const externalSteam = firstLink(external, item => typeId(item.external_game_source) === 1);
  const externalYoutube = firstLink(external, item => typeId(item.external_game_source) === 10);
  const externalEpic = firstLink(external, item => typeId(item.external_game_source) === 26);
  return {
    official,
    steam: websiteSteam || externalSteam,
    epic: websiteEpic || externalEpic,
    reddit,
    youtube: websiteYoutube || externalYoutube,
    igdb: game.url || ''
  };
}

function uniqueNames(items) {
  return [...new Set((items || []).map(item => item?.name).filter(Boolean))];
}

function transform(releases) {
  const games = new Map();
  for (const item of releases) {
    const source = item.game;
    if (!source?.id || !source.name || !item.date) continue;
    const id = String(source.id);
    if (!games.has(id)) {
      const companies = source.involved_companies || [];
      const cover = source.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${source.cover.image_id}.jpg`
        : (source.cover?.url || '').replace(/^\/\//, 'https://').replace(/\/t_[a-zA-Z0-9_]+\//, '/t_cover_big/');
      games.set(id, {
        id: source.id,
        name: source.name,
        slug: source.slug || '',
        summary: source.summary || source.storyline || '',
        cover,
        genres: uniqueNames(source.genres),
        developers: [...new Set(companies.filter(c => c.developer).map(c => c.company?.name).filter(Boolean))],
        publishers: [...new Set(companies.filter(c => c.publisher).map(c => c.company?.name).filter(Boolean))],
        rating: Number(source.total_rating || source.rating || 0) || 0,
        ratingCount: Number(source.total_rating_count || source.rating_count || 0) || 0,
        igdbUrl: source.url || '',
        trailerId: source.videos?.[0]?.video_id || '',
        links: makeLinks(source),
        releases: []
      });
    }

    const game = games.get(id);
    const date = dayString(new Date(item.date * 1000));
    let release = game.releases.find(r => r.date === date);
    if (!release) {
      release = { date, timestamp: item.date, platforms: [] };
      game.releases.push(release);
    }
    if (item.platform && !release.platforms.some(p => p.id === item.platform.id)) {
      release.platforms.push({
        id: item.platform.id,
        name: item.platform.name || String(item.platform.id),
        abbreviation: item.platform.abbreviation || ''
      });
    }
  }

  const result = [...games.values()];
  for (const game of result) {
    game.releases.sort((a,b) => a.date.localeCompare(b.date));
    for (const release of game.releases) release.platforms.sort((a,b) => a.name.localeCompare(b.name));
  }
  result.sort((a,b) => (a.releases[0]?.date || '').localeCompare(b.releases[0]?.date || '') || a.name.localeCompare(b.name));
  return result;
}

async function atomicWrite(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  console.log('🔐 Získávám Twitch token…');
  const token = await getToken();
  const platforms = await discoverPlatforms(token);
  const releases = [];
  for (let offset = -MONTHS_PAST; offset < MONTHS_FUTURE; offset++) {
    releases.push(...await fetchMonth(offset, platforms, token));
  }

  const games = transform(releases);
  const allDates = games.flatMap(game => game.releases.map(r => r.date)).sort();
  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    range: allDates.length ? { from: allDates[0], to: allDates.at(-1) } : null,
    platforms,
    games
  };

  await atomicWrite(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  const releaseCount = games.reduce((sum, game) => sum + game.releases.length, 0);
  console.log(`✅ Uloženo ${games.length} her / ${releaseCount} datumů vydání do ${OUTPUT}`);
}

main().catch(error => {
  console.error('❌ Aktualizace games.json selhala. Původní soubor zůstal zachovaný.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
