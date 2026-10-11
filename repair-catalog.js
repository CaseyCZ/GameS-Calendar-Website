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

function canonicalPlatform(platform = {}) {
  if (!platform) return platform;
  const source = typeof platform === 'string' ? { name:platform } : { ...platform };
  const key = normalize(source.name || source.abbreviation);
  const aliases = new Map([
    ['series x s', ['Xbox Series X|S', 'XSX']],
    ['xbox series x s', ['Xbox Series X|S', 'XSX']],
    ['xbox series', ['Xbox Series X|S', 'XSX']],
    ['xone', ['Xbox One', 'XONE']],
    ['xb1', ['Xbox One', 'XONE']],
    ['xbox one', ['Xbox One', 'XONE']],
    ['browser', ['Web browser', 'WEB']],
    ['web browser', ['Web browser', 'WEB']],
    ['pc microsoft windows', ['PC (Microsoft Windows)', 'PC']]
  ]);
  const mapped = aliases.get(key);
  if (!mapped) return source;
  return { ...source, name:mapped[0], abbreviation:source.abbreviation || mapped[1] };
}

function canonicalPlatforms(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of values || []) {
    const platform = canonicalPlatform(raw);
    const key = normalize(platform?.name || platform?.abbreviation);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(platform);
  }
  return result;
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
      map.set(key, { ...release, platforms:canonicalPlatforms(release.platforms || []), regions:uniq(release.regions || []) });
      continue;
    }
    const target = map.get(key);
    target.platforms = canonicalPlatforms([...(target.platforms || []), ...(release.platforms || [])]);
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

function releaseLabel(release = {}) {
  const day = String(release.date || release.day || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [year, month, date] = day.split('-');
    return `${Number(date)}. ${Number(month)}. ${year}`;
  }
  return String(release.window || '').trim() || 'TBA';
}

function generatedText(game = {}) {
  const genres = canonicalGenres(game.genres || []);
  const developers = game.developers || [];
  const platforms = uniq((game.releases || []).flatMap(release => (release.platforms || []).map(item => item?.name).filter(Boolean))).slice(0, 4);
  let text = genres.length ? `${game.name} je hra z kategorie ${genres.slice(0, 2).join(' / ')}` : `${game.name} je videohra`;
  if (developers.length) text += ` od studia ${developers[0]}`;
  if (platforms.length) text += ` pro ${platforms.join(', ')}`;
  const first = game.releases?.[0];
  if (first) text += `. Termín vydání: ${releaseLabel(first)}.`;
  else text += '.';
  return text;
}

function latestIso(...values) {
  return values.filter(Boolean).map(String).sort().at(-1) || null;
}

function mergeSubscriptions(a = {}, b = {}) {
  const merged = { ...a, ...b };
  for (const key of ['gamePass','gamePassConsole','gamePassPc','cloudGaming','psPlus','geforceNow','eaPlay']) {
    merged[key] = Boolean(a?.[key] || b?.[key]);
  }

  for (const key of ['gamePassProductId','geforceNowGameId','psPlusProductId']) {
    merged[key] = b?.[key] || a?.[key] || '';
    if (!merged[key]) delete merged[key];
  }

  for (const key of ['gamePassSource','geforceNowSource','psPlusSource']) {
    merged[key] = b?.[key] || a?.[key] || '';
    if (!merged[key]) delete merged[key];
  }

  for (const key of ['checkedAt','gamePassCheckedAt','geforceNowCheckedAt','psPlusCheckedAt']) {
    const value = latestIso(a?.[key], b?.[key]);
    if (value) merged[key] = value;
    else delete merged[key];
  }

  return merged;
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
    subscriptions:mergeSubscriptions(a.subscriptions || {}, b.subscriptions || {}),
    contentType:canonicalContentType(preferred.contentType || secondary.contentType),
    releases:mergeReleases([...(a.releases || []), ...(b.releases || [])])
  };
}

function lastDayOfMonth(date) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function placeholderDates(games = []) {
  const counts = new Map();
  for (const game of games) {
    for (const release of game.releases || []) {
      const precision = String(release.precision || (release.date || release.day ? 'day' : 'unknown')).toLowerCase();
      const date = String(release.date || release.day || '');
      if (precision !== 'day' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) continue;
      counts.set(date, (counts.get(date) || 0) + 1);
    }
  }
  const threshold = Math.max(25, Math.ceil(games.length * 0.006));
  return new Set(
    [...counts.entries()]
      .filter(([date, count]) => count >= threshold && (date.endsWith('-01') || lastDayOfMonth(date)))
      .map(([date]) => date)
  );
}

function fuzzifySuspicious(release = {}, placeholders = new Set()) {
  const precision = String(release.precision || (release.date || release.day ? 'day' : 'unknown')).toLowerCase();
  const date = String(release.date || release.day || '');
  const precisionSource = String(release.precisionSource || '').trim();

  if (precision !== 'day' || !date) {
    return precisionSource ? release : {
      ...release,
      precisionSource:'catalog-legacy-preserved'
    };
  }

  const trustedExact = precisionSource.startsWith('igdb-date-format') || precisionSource.startsWith('steam-store-live');
  const boundary = /^20\d{2}-(03-31|06-30|09-30|12-31)$/.test(date);
  const suspicious = placeholders.has(date) || (boundary && !trustedExact);

  if (!suspicious || trustedExact) {
    return precisionSource ? release : {
      ...release,
      precisionSource:'catalog-legacy-exact'
    };
  }

  const [year, month] = date.split('-');
  const yearOnly = date.endsWith('-12-31') && Number(month) === 12;
  const nextPrecision = yearOnly ? 'year' : 'month';
  const window = yearOnly ? year : `${month}/${year}`;
  return {
    ...release,
    date:null,
    day:undefined,
    timestamp:0,
    window,
    precision:nextPrecision,
    precisionSource:'catalog-placeholder-repair'
  };
}

function repairGame(game, placeholders) {
  const releases = mergeReleases((game.releases || []).map(release => fuzzifySuspicious(release, placeholders)));
  const repaired = {
    ...game,
    genres:canonicalGenres(game.genres || []),
    contentType:canonicalContentType(game.contentType || ''),
    releases
  };
  if (generatedSummary(repaired.summary)) repaired.summary = generatedText(repaired);
  return repaired;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const rawGames = payload.games || [];
  const placeholders = placeholderDates(rawGames);
  const source = rawGames.map(game => repairGame(game, placeholders));
  const result = [];
  const identity = new Map();
  let merged = 0;
  for (const game of source) {
    const keys = new Set();
    const rawId = String(game.id ?? '').trim();
    const igdbId = String(game.igdbId ?? '').trim();
    if (igdbId) keys.add(`igdb:${igdbId}`);
    if (rawId) {
      keys.add(`id:${rawId}`);
      const legacyIgdbId = rawId.match(/^igdb-(\d+)$/)?.[1];
      if (legacyIgdbId) keys.add(`igdb:${legacyIgdbId}`);
      if (/^\d+$/.test(rawId)) keys.add(`igdb:${rawId}`);
    }

    const existingIndexes = [...keys]
      .map(key => identity.get(key))
      .filter(index => Number.isInteger(index));
    const index = existingIndexes.length ? Math.min(...existingIndexes) : -1;

    if (index < 0) {
      const nextIndex = result.length;
      result.push(game);
      for (const key of keys) identity.set(key, nextIndex);
      continue;
    }

    result[index] = mergeGame(result[index], game);
    const mergedGame = result[index];
    const mergedRawId = String(mergedGame.id ?? '').trim();
    const mergedIgdbId = String(mergedGame.igdbId ?? '').trim();
    for (const key of keys) identity.set(key, index);
    if (mergedIgdbId) identity.set(`igdb:${mergedIgdbId}`, index);
    if (mergedRawId) {
      identity.set(`id:${mergedRawId}`, index);
      const legacyIgdbId = mergedRawId.match(/^igdb-(\d+)$/)?.[1];
      if (legacyIgdbId) identity.set(`igdb:${legacyIgdbId}`, index);
      if (/^\d+$/.test(mergedRawId)) identity.set(`igdb:${mergedRawId}`, index);
    }
    merged += 1;
  }
  const usedIds = new Set();
  let rekeyed = 0;
  for (const game of result) {
    const original = String(game.id ?? '');
    if (original && !usedIds.has(original)) {
      usedIds.add(original);
      continue;
    }
    const base = game.igdbId
      ? `igdb-${game.igdbId}`
      : `game-${normalize(game.name) || 'unknown'}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    game.id = candidate;
    usedIds.add(candidate);
    rekeyed += 1;
  }

  payload.games = result;
  payload.generatedAt = new Date().toISOString();
  await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Catalog repair: ${source.length} -> ${result.length} games; merged=${merged}; rekeyed=${rekeyed}; placeholderDates=${[...placeholders].sort().join(',') || 'none'}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
