#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const LIMIT = Math.max(1, Math.min(190, Number(process.env.STEAM_MEDIA_LIMIT || 180)));
const DELAY_MS = Math.max(1600, Number(process.env.STEAM_MEDIA_DELAY_MS || 1750));
const RETRY_AFTER_DAYS = Math.max(1, Number(process.env.STEAM_MEDIA_RETRY_DAYS || 21));
const USER_AGENT = 'GameS-Calendar/3.1 (https://caseycz.github.io/GameS-Calendar-Website/; Steam public store metadata)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uniq = values => [...new Set((values || []).filter(Boolean))];

function steamIdFromGame(game) {
  if (game?.steamId) return String(game.steamId);
  const match = String(game?.links?.steam || '').match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match?.[1] || '';
}

function shortText(value, max = 520) {
  const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const word = head.lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : max)}…`;
}

function nearestReleaseDistance(game) {
  const now = Date.now();
  const dates = (game.releases || [])
    .map(release => Date.parse(`${release.date || ''}T00:00:00Z`))
    .filter(Number.isFinite);
  if (!dates.length) return Number.MAX_SAFE_INTEGER;
  return Math.min(...dates.map(ms => Math.abs(ms - now)));
}

function mediaComplete(game) {
  const screenshots = Array.isArray(game.screenshots) && game.screenshots.length > 0;
  const trailer = Boolean(game.trailerId || game.trailerUrl);
  return screenshots && trailer;
}

function recentlyChecked(game) {
  const checked = Date.parse(game.steamMediaCheckedAt || '');
  return Number.isFinite(checked) && Date.now() - checked < RETRY_AFTER_DAYS * 86400000;
}

async function fetchAppDetails(appid, attempt = 0) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=cz&l=english`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  });

  if (response.status === 429 && attempt < 4) {
    const wait = 12_000 + attempt * 10_000;
    console.warn(`⏳ Steam 429 pro ${appid}, čekám ${Math.round(wait / 1000)} s…`);
    await sleep(wait);
    return fetchAppDetails(appid, attempt + 1);
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  const payload = JSON.parse(text);
  return payload?.[appid]?.success ? payload[appid].data : null;
}

function applySteamData(game, appid, data) {
  game.steamId = appid;
  game.steamMediaCheckedAt = new Date().toISOString();
  if (!data) return;

  if (!game.cover && data.header_image) game.cover = data.header_image;
  if (!game.summary && data.short_description) game.summary = shortText(data.short_description);
  game.developers = uniq([...(game.developers || []), ...(data.developers || [])]);
  game.publishers = uniq([...(game.publishers || []), ...(data.publishers || [])]);

  const genres = (data.genres || []).map(item => item.description).filter(Boolean);
  if (genres.some(value => /early access/i.test(value))) game.earlyAccess = true;

  const screenshots = (data.screenshots || [])
    .slice(0, 12)
    .map(item => ({
      full: item.path_full || '',
      thumb: item.path_thumbnail || item.path_full || ''
    }))
    .filter(item => item.full);
  if (screenshots.length) game.screenshots = screenshots;

  const movie = (data.movies || []).find(item => item?.mp4?.max || item?.mp4?.['480']);
  if (movie) {
    game.trailerUrl = movie.mp4?.max || movie.mp4?.['480'] || game.trailerUrl || '';
    game.trailerPoster = movie.thumbnail || game.trailerPoster || '';
  }

  game.links = {
    ...(game.links || {}),
    steam: `https://store.steampowered.com/app/${encodeURIComponent(appid)}/`
  };
}

async function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  const raw = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const games = Array.isArray(raw?.games) ? raw.games : [];
  if (!games.length) throw new Error('games.json neobsahuje pole games.');

  const candidates = games
    .filter(game => steamIdFromGame(game))
    .filter(game => !mediaComplete(game))
    .filter(game => !recentlyChecked(game))
    .sort((a, b) => nearestReleaseDistance(a) - nearestReleaseDistance(b))
    .slice(0, LIMIT);

  console.log(`🎬 Steam média: ${candidates.length} her zpracujeme pomalu, aby nedošlo k rate limitu.`);

  let updated = 0;
  let screenshots = 0;
  let trailers = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const game = candidates[index];
    const appid = steamIdFromGame(game);
    try {
      const data = await fetchAppDetails(appid);
      applySteamData(game, appid, data);
      if (game.screenshots?.length) screenshots += 1;
      if (game.trailerId || game.trailerUrl) trailers += 1;
      updated += 1;
      console.log(`✅ ${index + 1}/${candidates.length} ${game.name}`);
    } catch (error) {
      console.warn(`⚠️ ${game.name}: ${error.message}`);
    }
    if (index + 1 < candidates.length) await sleep(DELAY_MS);
  }

  if (!updated) {
    console.log('ℹ️ Žádná Steam média nebyla změněna.');
    return;
  }

  raw.generatedAt = new Date().toISOString();
  await atomicWrite(OUTPUT, JSON.stringify(raw, null, 2) + '\n');
  console.log(`🎉 Aktualizováno ${updated} her · screenshoty ${screenshots} · trailery ${trailers}.`);
}

main().catch(error => {
  console.error('❌ Steam media enrichment selhal.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
