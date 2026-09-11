#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.resolve(process.env.GAMES_OUTPUT || 'games.json');
const WD_API = 'https://www.wikidata.org/w/api.php';
const WIKI_API = 'https://cs.wikipedia.org/w/api.php';
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.METADATA_CONCURRENCY || 5)));
const STEAM_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.STEAM_CONCURRENCY || 2)));
const RETRY_MISSES_AFTER_DAYS = Math.max(1, Number(process.env.METADATA_RETRY_DAYS || 30));
const STEAM_RETRY_DAYS = Math.max(1, Number(process.env.STEAM_RETRY_DAYS || 14));
const MAX_RETRIES = 5;
const USER_AGENT = 'GameS-Calendar/3.0 (https://caseycz.github.io/GameS-Calendar-Website/; public game metadata enrichment)';

const OFFICIAL_CATALOGS = {
  gamePass: 'https://www.xbox.com/cs-CZ/xbox-game-pass/games',
  psPlus: 'https://www.playstation.com/cs-cz/ps-plus/games/',
  geforceNow: 'https://www.nvidia.com/cs-cz/geforce-now/games/'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pad = n => String(n).padStart(2, '0');
const uniq = values => [...new Set((values || []).filter(Boolean))];

const GENRE_CS = new Map(Object.entries({
  'action game': 'Akční', 'action video game': 'Akční',
  'action-adventure game': 'Akční adventura', 'action-adventure video game': 'Akční adventura',
  'adventure game': 'Adventura', 'adventure video game': 'Adventura',
  'role-playing video game': 'RPG', 'role-playing game': 'RPG',
  'action role-playing game': 'Akční RPG', 'action role-playing video game': 'Akční RPG',
  'sports video game': 'Sportovní', 'sports game': 'Sportovní',
  'simulation video game': 'Simulace', 'simulation game': 'Simulace',
  'strategy video game': 'Strategie', 'strategy game': 'Strategie',
  'racing video game': 'Závodní', 'racing game': 'Závodní',
  'platform game': 'Plošinovka', 'platformer': 'Plošinovka',
  'puzzle video game': 'Logická', 'puzzle game': 'Logická',
  'fighting game': 'Bojová', 'survival horror': 'Survival horor', 'horror game': 'Horor',
  'first-person shooter': 'FPS', 'third-person shooter': 'TPS', 'shooter game': 'Střílečka',
  'real-time strategy': 'RTS', 'turn-based strategy': 'Tahová strategie',
  'ice hockey video game': 'Hokej', 'association football video game': 'Fotbal',
  'football video game': 'Fotbal', 'basketball video game': 'Basketbal', 'baseball video game': 'Baseball',
  'battle royale game': 'Battle royale', 'metroidvania': 'Metroidvania', 'sandbox game': 'Sandbox',
  'roguelike': 'Roguelike', 'roguelite': 'Roguelite', 'visual novel': 'Vizuální novela',
  'massively multiplayer online role-playing game': 'MMORPG', 'rhythm game': 'Rytmická',
  'party game': 'Párty', 'stealth game': 'Stealth', 'survival game': 'Survival',
  'city-building game': 'Budovatelská', 'management game': 'Management',
  'turn-based tactics': 'Tahová taktika', 'tactical role-playing game': 'Taktické RPG'
}));

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dayFrom(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!value) return null;
  let ms;
  if (typeof value === 'number') ms = value > 1e12 ? value : value * 1000;
  else if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value); ms = n > 1e12 ? n : n * 1000;
  } else ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function timestampFromDay(day) {
  return day ? Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) : 0;
}

function coverUrl(value) {
  if (!value) return '';
  let url = typeof value === 'string' ? value : value.url || '';
  if (url.startsWith('//')) url = `https:${url}`;
  return url.replace(/\/t_[a-zA-Z0-9_]+\//, '/t_cover_big/');
}

function normalizePlatform(platform) {
  if (!platform) return null;
  if (typeof platform === 'string') return { id: null, name: platform, abbreviation: '' };
  const name = platform.name || platform.abbreviation || platform.abbr || String(platform.id || '');
  if (!name) return null;
  return { id: platform.id ?? null, name, abbreviation: platform.abbreviation || platform.abbr || '' };
}

function normalizeLinks(links = {}, game = {}) {
  return {
    official: links.official || '', steam: links.steam || '', epic: links.epic || '',
    reddit: links.reddit || '', youtube: links.youtube || '', wikipedia: links.wikipedia || '',
    igdb: links.igdb || game.igdbUrl || game.url || ''
  };
}

function normalizeRelease(release = {}) {
  const date = dayFrom(release.date ?? release.day ?? release.timestamp);
  const window = String(release.window || release.releaseWindow || release.label || '').trim();
  if (!date && !window) return null;
  return {
    date,
    timestamp: release.timestamp || timestampFromDay(date),
    platforms: (release.platforms || []).map(normalizePlatform).filter(Boolean),
    window,
    precision: release.precision || release.datePrecision || (date ? 'day' : 'unknown'),
    regions: uniq(release.regions || [])
  };
}

function normalizeExisting(raw) {
  if (raw && Array.isArray(raw.games)) {
    return raw.games.map(game => ({
      ...game,
      id: game.id ?? game.name,
      name: game.name || 'Neznámá hra',
      aliases: uniq(game.aliases || game.alternativeNames || []),
      summary: game.summary || '', storyline: game.storyline || '', cover: coverUrl(game.cover),
      genres: uniq((game.genres || []).map(x => typeof x === 'string' ? x : x?.name)),
      developers: uniq((game.developers || []).map(x => typeof x === 'string' ? x : x?.name)),
      publishers: uniq((game.publishers || []).map(x => typeof x === 'string' ? x : x?.name)),
      series: uniq((game.series || []).map(x => typeof x === 'string' ? x : x?.name)),
      screenshots: Array.isArray(game.screenshots) ? game.screenshots : [],
      subscriptions: game.subscriptions || {},
      regionalReleases: Array.isArray(game.regionalReleases) ? game.regionalReleases : [],
      links: normalizeLinks(game.links, game),
      releases: (game.releases || []).map(normalizeRelease).filter(Boolean)
    })).filter(game => game.releases.length);
  }
  if (!Array.isArray(raw)) throw new Error('games.json má neznámý formát.');
  const map = new Map();
  for (const item of raw) {
    const nested = item?.game || item || {};
    const name = nested.name || item?.name;
    const date = dayFrom(item?.date ?? item?.first_release_date ?? nested.first_release_date);
    if (!name || !date) continue;
    const id = nested.id ?? item?.game_id ?? name;
    const key = String(id);
    if (!map.has(key)) {
      map.set(key, {
        id, name, slug: nested.slug || '', aliases: [], summary: nested.summary || '', storyline: nested.storyline || '',
        cover: coverUrl(nested.cover || item?.cover), genres: uniq((nested.genres || []).map(x => typeof x === 'string' ? x : x?.name)),
        developers: [], publishers: [], series: [], rating: Number(nested.rating || nested.total_rating || 0) || 0,
        ratingCount: Number(nested.rating_count || nested.total_rating_count || 0) || 0,
        trailerId: nested.videos?.[0]?.video_id || '', trailerUrl: '', trailerPoster: '', screenshots: [], subscriptions: {},
        regionalReleases: [], links: normalizeLinks({}, nested), releases: []
      });
    }
    const game = map.get(key);
    let release = game.releases.find(r => r.date === date);
    if (!release) {
      release = { date, timestamp: timestampFromDay(date), platforms: [], window: '', precision: 'day', regions: [] };
      game.releases.push(release);
    }
    const sourcePlatforms = item?.platforms || nested.platforms || (item?.platform ? [item.platform] : []);
    for (const p of sourcePlatforms) {
      const normalized = normalizePlatform(p);
      if (normalized && !release.platforms.some(existing => existing.name === normalized.name)) release.platforms.push(normalized);
    }
  }
  return [...map.values()];
}

async function requestText(url, attempt = 0) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
  const text = await response.text();
  if (!response.ok && attempt < MAX_RETRIES && (response.status === 429 || response.status >= 500)) {
    const wait = Math.min(12_000, 700 * (2 ** attempt)) + Math.floor(Math.random() * 400);
    await sleep(wait);
    return requestText(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

async function requestJson(url, attempt = 0) {
  const text = await requestText(url, attempt);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Neplatný JSON z ${url}`); }
  const maxlag = payload?.error?.code === 'maxlag';
  if (maxlag && attempt < MAX_RETRIES) {
    await sleep(Math.min(12_000, 700 * (2 ** attempt)));
    return requestJson(url, attempt + 1);
  }
  if (payload?.error) throw new Error(`${payload.error.code}: ${payload.error.info || 'API error'}`);
  return payload;
}

function apiUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  return url;
}

async function wikidata(params) {
  return requestJson(apiUrl(WD_API, { format: 'json', origin: '*', maxlag: 5, ...params }));
}

function firstReleaseYear(game) {
  return Number((game.releases || []).map(r => r.date).filter(Boolean).sort()[0]?.slice(0,4) || 0);
}

function candidateScore(game, result) {
  const target = normalizeName(game.name);
  const label = normalizeName(result.label || result.display?.label?.value || '');
  const desc = String(result.description || result.display?.description?.value || '').toLowerCase();
  const year = firstReleaseYear(game);
  let score = 0;
  if (label === target) score += 100;
  else if (label && (label.includes(target) || target.includes(label))) score += 35;
  if (/video game|videogame|computer game/.test(desc)) score += 45;
  else if (/\bgame\b/.test(desc)) score += 20;
  if (year && desc.includes(String(year))) score += 15;
  if (/film|album|song|novel|television|tv series|board game/.test(desc) && !/video game|videogame|computer game/.test(desc)) score -= 100;
  return score;
}

function shouldRetryMiss(game) {
  if (game.wikidataId) return false;
  if (game.metadataStatus !== 'not-found' || !game.metadataCheckedAt) return true;
  const checked = Date.parse(game.metadataCheckedAt);
  return !Number.isFinite(checked) || Date.now() - checked >= RETRY_MISSES_AFTER_DAYS * 86400000;
}

async function searchGame(game) {
  const payload = await wikidata({ action: 'wbsearchentities', search: game.name, language: 'en', uselang: 'en', type: 'item', limit: 7 });
  const ranked = (payload.search || []).map(result => ({ result, score: candidateScore(game, result) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best && best.score >= 100 ? best.result.id : null;
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return out;
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function fetchEntities(ids, props = 'labels|descriptions|aliases|claims|sitelinks') {
  const result = new Map();
  for (const batch of chunks(uniq(ids), 50)) {
    if (!batch.length) continue;
    const payload = await wikidata({
      action: 'wbgetentities', ids: batch.join('|'), props, languages: 'cs|en', languagefallback: 1,
      sitefilter: props.includes('sitelinks') ? 'cswiki|enwiki' : undefined
    });
    for (const [id, entity] of Object.entries(payload.entities || {})) result.set(id, entity);
    await sleep(80);
  }
  return result;
}

function claimItemIds(entity, property) {
  return uniq((entity?.claims?.[property] || []).map(claim => claim?.mainsnak?.datavalue?.value?.id).filter(Boolean));
}

function qualifierItemIds(claim, properties) {
  return uniq(properties.flatMap(property => (claim?.qualifiers?.[property] || []).map(q => q?.datavalue?.value?.id).filter(Boolean)));
}

function claimStrings(entity, property) {
  return uniq((entity?.claims?.[property] || []).map(claim => claim?.mainsnak?.datavalue?.value).filter(value => typeof value === 'string' && value.trim()));
}

function entityLabel(entity) {
  return entity?.labels?.cs?.value || entity?.labels?.en?.value || '';
}

function entityAliases(entity) {
  return uniq([...(entity?.aliases?.cs || []), ...(entity?.aliases?.en || [])].map(item => item?.value).filter(Boolean));
}

function translatedGenre(value) {
  const label = String(value || '').trim();
  if (!label) return '';
  const key = label.toLowerCase();
  if (GENRE_CS.has(key)) return GENRE_CS.get(key);
  return label.replace(/\s+video game$/i, '').replace(/\s+game$/i, '').replace(/^./, char => char.toLocaleUpperCase('cs'));
}

async function fetchCzechExtracts(entities) {
  const titleToQid = new Map();
  for (const [qid, entity] of entities) {
    const title = entity?.sitelinks?.cswiki?.title;
    if (title) titleToQid.set(title, qid);
  }
  const qidToExtract = new Map();
  for (const batch of chunks([...titleToQid.keys()], 20)) {
    if (!batch.length) continue;
    const payload = await requestJson(apiUrl(WIKI_API, {
      action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, redirects: 1,
      titles: batch.join('|'), format: 'json', formatversion: 2, origin: '*'
    }));
    for (const page of payload?.query?.pages || []) {
      const qid = titleToQid.get(page.title);
      if (qid && page.extract) qidToExtract.set(qid, String(page.extract).replace(/\s+/g, ' ').trim());
    }
    await sleep(80);
  }
  return qidToExtract;
}

function shortText(value, max = 520) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence > max * 0.5) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : max)}…`;
}

function formatCzechDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return '';
  const [y,m,d] = day.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function generatedSummary(game, genres, developers, publishers) {
  const firstRelease = (game.releases || []).map(r => r.date).filter(Boolean).sort()[0] || '';
  const platforms = uniq((game.releases || []).flatMap(r => (r.platforms || []).map(p => p.name))).slice(0, 4);
  let text = genres.length ? `${game.name} je hra z kategorie ${genres.slice(0, 2).join(' / ')}` : `${game.name} je videohra`;
  if (developers.length) text += ` od ${developers[0]}`;
  if (publishers.length && publishers[0] !== developers[0]) text += `, kterou vydává ${publishers[0]}`;
  if (platforms.length) text += ` pro ${platforms.join(', ')}`;
  text += '.';
  if (firstRelease) text += ` Datum vydání: ${formatCzechDate(firstRelease)}.`;
  return text;
}

function parseWikidataTime(snak) {
  const value = snak?.datavalue?.value;
  const time = value?.time;
  const precision = value?.precision;
  if (!time || !precision) return null;
  const match = time.match(/^\+?(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (precision >= 11 && month && day) return { day: `${year}-${pad(month)}-${pad(day)}`, label: `${day}. ${month}. ${year}`, precision: 'day' };
  if (precision === 10 && month) return { day: null, label: `${month}. ${year}`, precision: 'month', year, month };
  return { day: null, label: String(year), precision: 'year', year };
}

function regionCode(label = '') {
  const n = normalizeName(label);
  if (/united states|usa|spojene staty|north america/.test(n)) return 'US';
  if (/japan|japonsko/.test(n)) return 'JP';
  if (/europe|european union|evropa|evropska unie/.test(n)) return 'EU';
  return '';
}

function releaseMetadata(entity, labels) {
  const regional = [];
  const windows = [];
  for (const claim of entity?.claims?.P577 || []) {
    const parsed = parseWikidataTime(claim?.mainsnak);
    if (!parsed) continue;
    if (parsed.precision !== 'day') windows.push(parsed);
    const qualifierIds = qualifierItemIds(claim, ['P291','P1001']);
    for (const id of qualifierIds) {
      const label = entityLabel(labels.get(id));
      const region = regionCode(label);
      if (region) regional.push({ region, day: parsed.day, label: parsed.label, precision: parsed.precision });
    }
  }
  const uniqRegional = [];
  const seen = new Set();
  for (const item of regional) {
    const key = `${item.region}|${item.day || item.label}`;
    if (!seen.has(key)) { seen.add(key); uniqRegional.push(item); }
  }
  windows.sort((a,b) => (a.year || 9999) - (b.year || 9999) || (a.month || 0) - (b.month || 0));
  return { regionalReleases: uniqRegional, announcedWindow: windows[0]?.label || '' };
}

function detectScale({ classLabels = [], summary = '', steamGenres = [] }) {
  const text = [...classLabels, summary, ...steamGenres].join(' ').toLowerCase();
  if (/\baaa\b|triple-a|triple a/.test(text)) return 'AAA';
  if (/indie|independent video game|independent game|nezavisla hra|nezavisle videohry/.test(normalizeName(text))) return 'Indie';
  if (/small[- ]scale|low[- ]budget|nizkorozpoct/.test(normalizeName(text))) return 'Menší titul';
  return '';
}

function steamIdFromGame(game) {
  if (game.steamId) return String(game.steamId);
  const match = String(game.links?.steam || '').match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match?.[1] || '';
}

function steamFresh(game) {
  const checked = Date.parse(game.steamMetadataCheckedAt || '');
  return Number.isFinite(checked) && Date.now() - checked < STEAM_RETRY_DAYS * 86400000;
}

async function enrichSteam(game) {
  const steamId = steamIdFromGame(game);
  if (!steamId || steamFresh(game)) return;
  try {
    const payload = await requestJson(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(steamId)}&cc=cz&l=english`);
    const data = payload?.[steamId]?.success ? payload[steamId].data : null;
    game.steamMetadataCheckedAt = new Date().toISOString();
    if (!data) return;
    game.steamId = steamId;
    const steamGenres = (data.genres || []).map(item => item.description).filter(Boolean);
    game.earlyAccess = steamGenres.some(value => /early access/i.test(value)) || Boolean(game.earlyAccess);
    game.scale = game.scale || detectScale({ summary: game.summary, steamGenres });
    game.developers = uniq([...(game.developers || []), ...(data.developers || [])]);
    game.publishers = uniq([...(game.publishers || []), ...(data.publishers || [])]);
    if (!game.cover && data.header_image) game.cover = data.header_image;
    if (!game.summary && data.short_description) game.summary = shortText(data.short_description);
    if (data.name && normalizeName(data.name) !== normalizeName(game.name)) game.aliases = uniq([...(game.aliases || []), data.name]);
    game.screenshots = (data.screenshots || []).slice(0, 10).map(item => ({ full: item.path_full || '', thumb: item.path_thumbnail || item.path_full || '' })).filter(item => item.full);
    const movie = (data.movies || [])[0];
    if (!game.trailerId && movie) {
      game.trailerUrl = movie.mp4?.max || movie.mp4?.['480'] || game.trailerUrl || '';
      game.trailerPoster = movie.thumbnail || game.trailerPoster || '';
    }
  } catch (error) {
    console.warn(`⚠️ Steam ${game.name}: ${error.message}`);
  }
  await sleep(120);
}

async function fetchCatalogTexts() {
  const result = {};
  await Promise.all(Object.entries(OFFICIAL_CATALOGS).map(async ([key, url]) => {
    try {
      const html = await requestText(url);
      result[key] = ` ${normalizeName(html.replace(/<[^>]+>/g, ' '))} `;
      console.log(`📚 ${key}: oficiální katalog načten.`);
    } catch (error) {
      result[key] = null;
      console.warn(`⚠️ ${key} katalog: ${error.message}`);
    }
  }));
  return result;
}

function catalogContains(text, name) {
  if (!text) return null;
  const needle = normalizeName(name);
  if (needle.length < 5) return false;
  return text.includes(` ${needle} `);
}

async function atomicWrite(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function main() {
  const raw = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  const games = normalizeExisting(raw);
  console.log(`🎮 Základ: ${games.length} her. Termíny a platformy zůstávají zachované.`);
  console.log('🌐 Metadata: Wikidata + česká Wikipedie + Steam, bez API klíče.');

  const toSearch = games.filter(shouldRetryMiss);
  let searched = 0, found = 0;
  await mapLimit(toSearch, CONCURRENCY, async (game, index) => {
    try {
      game.wikidataId = await searchGame(game);
      game.metadataCheckedAt = new Date().toISOString();
      game.metadataStatus = game.wikidataId ? 'matched' : 'not-found';
      if (game.wikidataId) found += 1;
    } catch (error) { console.warn(`⚠️ Hledání ${game.name}: ${error.message}`); }
    searched += 1;
    if ((index + 1) % 100 === 0) console.log(`🔎 Hledání ${index + 1}/${toSearch.length}, nalezeno ${found}`);
  });

  const qids = uniq(games.map(game => game.wikidataId));
  console.log(`🔗 Wikidata: ${qids.length} přiřazených her (${found} nově nalezeno, ${searched} hledáno).`);
  const entities = await fetchEntities(qids);

  const referencedIds = [];
  for (const entity of entities.values()) {
    for (const property of ['P136','P178','P123','P179','P31']) referencedIds.push(...claimItemIds(entity, property));
    for (const claim of entity?.claims?.P577 || []) referencedIds.push(...qualifierItemIds(claim, ['P291','P1001']));
  }
  const labels = await fetchEntities(uniq(referencedIds), 'labels');
  const extracts = await fetchCzechExtracts(entities);

  let withGenre = 0, withDeveloper = 0, withSummary = 0, withSeries = 0;
  for (const game of games) {
    const entity = game.wikidataId ? entities.get(game.wikidataId) : null;
    if (entity) {
      const genres = claimItemIds(entity, 'P136').map(id => translatedGenre(entityLabel(labels.get(id)))).filter(Boolean);
      const developers = claimItemIds(entity, 'P178').map(id => entityLabel(labels.get(id))).filter(Boolean);
      const publishers = claimItemIds(entity, 'P123').map(id => entityLabel(labels.get(id))).filter(Boolean);
      const series = claimItemIds(entity, 'P179').map(id => entityLabel(labels.get(id))).filter(Boolean);
      const classLabels = claimItemIds(entity, 'P31').map(id => entityLabel(labels.get(id))).filter(Boolean);
      const official = claimStrings(entity, 'P856')[0] || game.links?.official || '';
      const steamId = claimStrings(entity, 'P1733')[0] || steamIdFromGame(game);
      const igdbSlug = claimStrings(entity, 'P5794')[0] || '';
      const wikiTitle = entity?.sitelinks?.cswiki?.title || entity?.sitelinks?.enwiki?.title || '';
      const csExtract = extracts.get(game.wikidataId) || '';
      const releaseMeta = releaseMetadata(entity, labels);

      game.aliases = uniq([...(game.aliases || []), ...entityAliases(entity)]).filter(alias => normalizeName(alias) !== normalizeName(game.name));
      game.genres = uniq(genres.length ? genres : (game.genres || []));
      game.developers = uniq(developers.length ? developers : (game.developers || []));
      game.publishers = uniq(publishers.length ? publishers : (game.publishers || []));
      game.series = uniq(series.length ? series : (game.series || []));
      game.summary = shortText(csExtract) || game.summary || generatedSummary(game, game.genres, game.developers, game.publishers);
      game.scale = game.scale || detectScale({ classLabels, summary: game.summary });
      game.regionalReleases = releaseMeta.regionalReleases.length ? releaseMeta.regionalReleases : (game.regionalReleases || []);
      game.announcedWindow = game.announcedWindow || releaseMeta.announcedWindow || '';
      if (steamId) game.steamId = steamId;
      game.links = {
        ...normalizeLinks(game.links, game), official,
        steam: steamId ? `https://store.steampowered.com/app/${encodeURIComponent(steamId)}/` : (game.links?.steam || ''),
        wikipedia: wikiTitle ? `https://${entity?.sitelinks?.cswiki ? 'cs' : 'en'}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}` : (game.links?.wikipedia || ''),
        igdb: igdbSlug ? `https://www.igdb.com/games/${encodeURIComponent(igdbSlug)}` : (game.links?.igdb || `https://www.igdb.com/search?type=1&q=${encodeURIComponent(game.name)}`)
      };
    } else {
      game.summary = game.summary || generatedSummary(game, game.genres || [], game.developers || [], game.publishers || []);
    }
    if (game.genres?.length) withGenre += 1;
    if (game.developers?.length) withDeveloper += 1;
    if (game.summary) withSummary += 1;
    if (game.series?.length) withSeries += 1;
  }

  const steamGames = games.filter(game => steamIdFromGame(game) && !steamFresh(game));
  console.log(`🖼️ Steam: aktualizuji ${steamGames.length} her se známým Steam ID.`);
  await mapLimit(steamGames, STEAM_CONCURRENCY, enrichSteam);

  const catalogs = await fetchCatalogTexts();
  const catalogCheckedAt = new Date().toISOString();
  let gp = 0, ps = 0, gfn = 0;
  for (const game of games) {
    const previous = game.subscriptions || {};
    const gamePass = catalogContains(catalogs.gamePass, game.name);
    const psPlus = catalogContains(catalogs.psPlus, game.name);
    const geforceNow = catalogContains(catalogs.geforceNow, game.name);
    game.subscriptions = {
      gamePass: gamePass === null ? Boolean(previous.gamePass) : gamePass,
      psPlus: psPlus === null ? Boolean(previous.psPlus) : psPlus,
      geforceNow: geforceNow === null ? Boolean(previous.geforceNow) : geforceNow,
      checkedAt: (catalogs.gamePass || catalogs.psPlus || catalogs.geforceNow) ? catalogCheckedAt : (previous.checkedAt || null)
    };
    if (game.subscriptions.gamePass) gp += 1;
    if (game.subscriptions.psPlus) ps += 1;
    if (game.subscriptions.geforceNow) gfn += 1;
  }

  const allDates = games.flatMap(game => game.releases.map(r => r.date)).filter(Boolean).sort();
  const payload = {
    version: 5,
    provider: 'IGDB release data + Wikidata/Wikipedia + Steam metadata + official subscription catalogs',
    generatedAt: new Date().toISOString(),
    range: allDates.length ? { from: allDates[0], to: allDates.at(-1) } : null,
    games: games.sort((a, b) => (a.releases[0]?.date || '9999').localeCompare(b.releases[0]?.date || '9999') || a.name.localeCompare(b.name, 'cs'))
  };

  await atomicWrite(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`✅ Uloženo ${games.length} her.`);
  console.log(`🏷️ Žánr: ${withGenre}/${games.length} · Vývojář: ${withDeveloper}/${games.length} · Popis: ${withSummary}/${games.length} · Série: ${withSeries}/${games.length}`);
  console.log(`🎟️ Game Pass: ${gp} · PS Plus: ${ps} · GeForce NOW: ${gfn}`);
}

main().catch(error => {
  console.error('❌ Obohacení games.json selhalo. Původní soubor zůstal zachovaný.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
