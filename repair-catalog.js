#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');

const uniq = values => [...new Set((values || []).filter(Boolean))];
const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const GENRES = new Map(Object.entries({
  'action':'Akční','action game':'Akční','action video game':'Akční','akční videohra':'Akční','akční hra':'Akční',
  'action-adventure game':'Akční adventura','action-adventure video game':'Akční adventura','akční adventura':'Akční adventura',
  'adventure':'Adventura','adventure game':'Adventura','adventure video game':'Adventura','adventura':'Adventura','adventurní videohra':'Adventura',
  'role-playing (rpg)':'RPG','role-playing game':'RPG','role-playing video game':'RPG','role playing':'RPG','rpg':'RPG',
  'action role-playing game':'Akční RPG','action role-playing video game':'Akční RPG','akční hra na hrdiny':'Akční RPG',
  'simulator':'Simulace','simulation':'Simulace','simulation game':'Simulace','simulation video game':'Simulace','videoherní simulátor':'Simulace',
  'strategy':'Strategie','strategy game':'Strategie','strategy video game':'Strategie','strategická videohra':'Strategie',
  'turn-based strategy (tbs)':'Tahová strategie','turn-based strategy':'Tahová strategie','real time strategy (rts)':'RTS','real-time strategy':'RTS',
  'racing':'Závodní','racing game':'Závodní','racing video game':'Závodní','závodní videohra':'Závodní',
  'platform':'Plošinovka','platform game':'Plošinovka','platformer':'Plošinovka','plošinová videohra':'Plošinovka',
  'puzzle':'Logická','puzzle game':'Logická','puzzle video game':'Logická','logická videohra':'Logická',
  'shooter':'Střílečka','shooter game':'Střílečka','střílečka':'Střílečka','first-person shooter':'FPS','third-person shooter':'TPS',
  'sport':'Sportovní','sports game':'Sportovní','sports video game':'Sportovní','sportovní videohra':'Sportovní',
  'fighting':'Bojová','fighting game':'Bojová','fighting video game':'Bojová','bojová videohra':'Bojová',
  'visual novel':'Vizuální novela','vizuální román':'Vizuální novela',
  'casual':'Nenáročná','nenáročná videohra':'Nenáročná',
  'indie':'Indie','nezávislá videohra':'Indie',
  'arcade':'Arkáda','tactical':'Taktická','point-and-click':'Point-and-click',
  'card & board game':'Karetní a desková','massively multiplayer':'MMO','music':'Hudební','quiz/trivia':'Kvíz'
}));

function canonicalGenres(values = []) {
  return uniq(values.map(raw => {
    const key = String(raw || '').trim().toLowerCase();
    if (!key || key === 'early access' || key === 'free to play') return '';
    return GENRES.get(key) || String(raw).trim();
  }));
}

function canonicalContentType(value = '') {
  const key = normalize(value);
  if (!key) return '';
  if (['main game','plna hra','full game','game'].includes(key)) return 'Main Game';
  if (/^dlc|add on|addon/.test(key)) return 'DLC / Add-on';
  if (key.includes('standalone expansion')) return 'Standalone expansion';
  if (key.includes('expanded game')) return 'Expanded game';
  if (key.includes('expansion')) return 'Expansion';
  if (key.includes('remaster')) return 'Remaster';
  if (key.includes('remake')) return 'Remake';
  if (key.includes('demo')) return 'Demo';
  if (key.includes('mod')) return 'Mod';
  if (key.includes('bundle')) return 'Bundle';
  if (key.includes('port')) return 'Port';
  if (key.includes('episode')) return 'Episode';
  if (key.includes('season')) return 'Season';
  return value;
}

function releaseKey(release = {}) {
  return [
    release.date || release.day || '',
    String(release.window || '').trim().toLowerCase(),
    String(release.precision || (release.date || release.day ? 'day' : 'unknown')).toLowerCase()
  ].join('|');
}

function mergeReleases(values = []) {
  const map = new Map();
  for (const release of values) {
    const key = releaseKey(release);
    if (!map.has(key)) {
      map.set(key, { ...release, platforms:[...(release.platforms || [])], regions:uniq(release.regions || []) });
      continue;
    }
    const target = map.get(key);
    for (const platform of release.platforms || []) {
      const pk = normalize(platform?.name || platform?.abbreviation);
      if (pk && !target.platforms.some(item => normalize(item?.name || item?.abbreviation) === pk)) target.platforms.push(platform);
    }
    target.regions = uniq([...(target.regions || []), ...(release.regions || [])]);
  }
  return [...map.values()];
}

function richness(game = {}) {
  return [
    game.cover, game.summary && !generatedSummary(game.summary), game.rating, game.ratingCount,
    (game.screenshots || []).length, game.trailerId || game.trailerUrl,
    (game.developers || []).length, (game.publishers || []).length,
    game.steamId, game.wikidataId
  ].reduce((score, value) => score + (Array.isArray(value) ? Math.min(3, value.length) : value ? 1 : 0), 0);
}

function generatedSummary(value = '') {
  return /\b(?:je videohra|je hra z kategorie)\b|\bDatum vydání:\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/i.test(String(value || ''));
}

function mergeGame(a, b) {
  const preferred = richness(b) > richness(a) ? b : a;
  const secondary = preferred === a ? b : a;
  return {
    ...secondary,
    ...preferred,
    aliases:uniq([...(a.aliases || []), ...(b.aliases || [])]),
    genres:canonicalGenres([...(a.genres || []), ...(b.genres || [])]),
    developers:uniq([...(a.developers || []), ...(b.developers || [])]),
    publishers:uniq([...(a.publishers || []), ...(b.publishers || [])]),
    series:uniq([...(a.series || []), ...(b.series || [])]),
    screenshots:[...(preferred.screenshots || []), ...(secondary.screenshots || [])].filter((item,index,all)=>{
      const key = typeof item === 'string' ? item : item?.full || item?.thumb || JSON.stringify(item);
      return all.findIndex(other => (typeof other === 'string' ? other : other?.full || other?.thumb || JSON.stringify(other)) === key) === index;
    }),
    metadataSources:uniq([...(a.metadataSources || []), ...(b.metadataSources || [])]),
    contentType:canonicalContentType(preferred.contentType || secondary.contentType),
    releases:mergeReleases([...(a.releases || []), ...(b.releases || [])])
  };
}

function fuzzifySuspicious(release = {}) {
  const precision = String(release.precision || (release.date || release.day ? 'day' : 'unknown')).toLowerCase();
  const date = String(release.date || release.day || '');
  if (precision !== 'day' || !/^20\d{2}-(03-31|06-30|09-30|12-31)$/.test(date)) return release;
  const year = date.slice(0,4);
  const mmdd = date.slice(5);
  let nextPrecision = 'year';
  let window = year;
  if (mmdd === '03-31') { nextPrecision = 'q1'; window = `Q1 ${year}`; }
  if (mmdd === '06-30') { nextPrecision = 'q2'; window = `Q2 ${year}`; }
  if (mmdd === '09-30') { nextPrecision = 'q3'; window = `Q3 ${year}`; }
  return { ...release, date:null, day:undefined, timestamp:0, window, precision:nextPrecision };
}

function repairGame(game) {
  const releases = mergeReleases((game.releases || []).map(fuzzifySuspicious));
  return {
    ...game,
    genres:canonicalGenres(game.genres || []),
    contentType:canonicalContentType(game.contentType || ''),
    releases
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const source = (payload.games || []).map(repairGame);
  const result = [];
  const identity = new Map();
  let merged = 0;
  for (const game of source) {
    const key = game.igdbId ? `igdb:${game.igdbId}` : `id:${game.id}`;
    if (!identity.has(key)) {
      identity.set(key, result.length);
      result.push(game);
      continue;
    }
    const index = identity.get(key);
    result[index] = mergeGame(result[index], game);
    merged += 1;
  }
  payload.games = result;
  payload.generatedAt = new Date().toISOString();
  await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Catalog repair: ${source.length} -> ${result.length} games; merged=${merged}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
