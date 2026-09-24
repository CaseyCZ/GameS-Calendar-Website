import { platformIcon, serviceIcon, storeIcon as sharedStoreIcon } from './icons.js';
import { todayLocal } from './data.js';

const MONTHS = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const formatter = new Intl.NumberFormat('cs-CZ');

export { MONTHS, formatter };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
}

export function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

const LIVE_PRICE_SOURCES = [
  ['steam', 'Steam', 'steam'],
  ['epic', 'Epic', 'epic'],
  ['microsoft', 'Xbox', 'xbox'],
  ['playstation', 'PlayStation', 'playstation'],
  ['nintendo', 'Nintendo', 'nintendo']
];

export function formatLivePrice(price) {
  if (!price || typeof price !== 'object') return '';
  if (price.isFree === true) return 'Zdarma';

  const value = Number(price.current);
  const currency = String(price.currency || '').trim().toUpperCase();
  let text = '';
  if (Number.isFinite(value) && value >= 0 && currency) {
    try {
      text = new Intl.NumberFormat('cs-CZ', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'CZK' ? 0 : 2
      }).format(value);
    } catch {}
  }
  if (!text) text = String(price.currentText || '').trim();
  if (!text && Number.isFinite(value) && value >= 0) text = String(value);
  if (!text) return '';

  let discount = Number(price.discountPercent || 0);
  const regular = Number(price.regular);
  if (!discount && Number.isFinite(regular) && regular > 0 && Number.isFinite(value) && value > 0 && value < regular) {
    discount = Math.round((1 - value / regular) * 100);
  }
  const prefix = price.from ? 'od ' : '';
  return discount > 0
    ? `${prefix}${text} · −${Math.round(discount)} %`
    : `${prefix}${text}`;
}

function priceProvidersForRow(row) {
  const groups = new Set(row?.platformGroups || []);
  if (!groups.size) return new Set(LIVE_PRICE_SOURCES.map(([provider]) => provider));
  const providers = new Set();
  if (groups.has('PC')) ['steam','epic','microsoft'].forEach(provider => providers.add(provider));
  if (groups.has('PS5') || groups.has('PS4')) providers.add('playstation');
  if (groups.has('Xbox Series') || groups.has('Xbox One') || groups.has('Xbox 360')) providers.add('microsoft');
  if (groups.has('Switch') || groups.has('Switch 2')) providers.add('nintendo');
  if (groups.has('VR')) {
    const names = (row?.platforms || []).map(platform => String(platform?.name || '').toLowerCase());
    if (names.some(name => /steamvr|windows|pc/.test(name))) providers.add('steam');
    if (names.some(name => /playstation vr|ps vr/.test(name))) providers.add('playstation');
  }
  return providers;
}

function serviceKindsForRow(row) {
  const groups = new Set(row?.platformGroups || []);
  if (!groups.size) return null;
  const services = new Set();
  if (groups.has('PC') || groups.has('Xbox Series') || groups.has('Xbox One') || groups.has('Xbox 360')) {
    ['gamepass','cloud','eaplay','gfn'].forEach(kind => services.add(kind));
  }
  if (groups.has('PS5') || groups.has('PS4')) services.add('psplus');
  return services;
}

function livePriceAllowed(row, provider, price) {
  if (!price || typeof price !== 'object') return false;
  if (provider !== 'epic') return true;
  if (price.preorder === true) return true;
  const day = String(row?.day || '').slice(0, 10);
  return !(day && day > todayLocal());
}

function cardLivePrices(row, limit = 3) {
  const game = row.game;
  const allowedProviders = priceProvidersForRow(row);
  const items = LIVE_PRICE_SOURCES
    .filter(([provider]) => allowedProviders.has(provider))
    .map(([provider, label, kind]) => ({
      provider,
      label,
      kind,
      price: game.livePrices?.[provider],
      lastKnownPrice: Boolean(game.livePriceMeta?.[provider]?.lastKnownPrice)
    }))
    .filter(item => livePriceAllowed(row, item.provider, item.price))
    .map(item => ({
      ...item,
      text: item.lastKnownPrice ? `posl. ${formatLivePrice(item.price)}` : formatLivePrice(item.price)
    }))
    .filter(item => item.text);
  if (!items.length) return '';

  const shown = items.slice(0, limit);
  const more = Math.max(0, items.length - shown.length);
  return `<span class="card-live-prices" aria-label="Živé ceny">${shown.map(item =>
    `<span class="card-price-chip${item.lastKnownPrice ? ' is-stale' : ''}" title="${escapeHtml(item.lastKnownPrice ? `${item.label} · poslední známá cena` : item.label)}">${sharedStoreIcon(item.kind, { className:'brand-icon--price' })}<span>${escapeHtml(item.text)}</span></span>`
  ).join('')}${more ? `<span class="card-price-more">+${more}</span>` : ''}</span>`;
}

function livePriceForStore(row, kind) {
  const provider = { steam:'steam', epic:'epic', xbox:'microsoft', playstation:'playstation', nintendo:'nintendo' }[kind];
  if (!provider) return '';
  const price = row?.game?.livePrices?.[provider];
  if (!livePriceAllowed(row, provider, price)) return '';
  const text = formatLivePrice(price);
  if (!text) return '';
  return row.game.livePriceMeta?.[provider]?.lastKnownPrice ? `${text} · posl. známá` : text;
}

export function formatDate(day, options = { day:'2-digit', month:'2-digit', year:'numeric' }) {
  if (!day) return '—';
  return new Intl.DateTimeFormat('cs-CZ', { ...options, timeZone:'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function formatMonth(day) {
  if (!day) return '';
  const [year, month] = day.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function formatGenre(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLocaleLowerCase('en');
  if (['early access', 'free to play'].includes(key)) return '';
  const exact = new Map([
    ['action game','Akční'], ['action video game','Akční'],
    ['action-adventure game','Akční adventura'], ['action-adventure video game','Akční adventura'],
    ['adventure game','Adventura'], ['adventure video game','Adventura'],
    ['role-playing game','RPG'], ['role-playing video game','RPG'],
    ['action role-playing game','Akční RPG'], ['action role-playing video game','Akční RPG'],
    ['sports game','Sportovní'], ['sports video game','Sportovní'],
    ['simulation game','Simulace'], ['simulation video game','Simulace'],
    ['strategy game','Strategie'], ['strategy video game','Strategie'],
    ['racing game','Závodní'], ['racing video game','Závodní'],
    ['platform game','Plošinovka'], ['platformer','Plošinovka'],
    ['puzzle game','Logická'], ['puzzle video game','Logická'],
    ['fighting game','Bojová'], ['fighting video game','Bojová'],
    ['survival horror','Survival horor'], ['horror game','Horor'],
    ['first-person shooter','FPS'], ['third-person shooter','TPS'], ['shooter game','Střílečka'],
    ['real-time strategy','RTS'], ['turn-based strategy','Tahová strategie'],
    ['ice hockey video game','Hokej'], ['association football video game','Fotbal'],
    ['football video game','Fotbal'], ['basketball video game','Basketbal'], ['baseball video game','Baseball'],
    ['battle royale game','Battle royale'], ['metroidvania','Metroidvania'], ['sandbox game','Sandbox'],
    ['roguelike','Roguelike'], ['roguelite','Roguelite'], ['visual novel','Vizuální novela'],
    ['massively multiplayer online role-playing game','MMORPG'], ['rhythm game','Rytmická'],
    ['party game','Párty'], ['stealth game','Stealth'], ['survival game','Survival'],
    ['city-building game','Budovatelská'], ['management game','Management'],
    ['turn-based tactics','Tahová taktika'], ['tactical role-playing game','Taktické RPG'],
    ['action','Akční'], ['adventure','Adventura'], ['role-playing (rpg)','RPG'], ['simulator','Simulace'],
    ['strategy','Strategie'], ['turn-based strategy (tbs)','Tahová strategie'], ['real time strategy (rts)','RTS'],
    ['shooter','Střílečka'], ['platform','Plošinovka'], ['puzzle','Logická'], ['racing','Závodní'],
    ['sport','Sportovní'], ['fighting','Bojová'], ['tactical','Taktická'], ['visual novel','Vizuální novela'],
    ['point-and-click','Point-and-click'], ['hack and slash/beat em up','Hack and slash'],
    ['card & board game','Karetní a desková'], ['moba','MOBA'], ['music','Hudební'],
    ['quiz/trivia','Kvíz'], ['arcade','Arkáda'], ['pinball','Pinball'], ['indie','Indie'],
    ['akční videohra','Akční'], ['akční hra','Akční'], ['adventurní videohra','Adventura'],
    ['nezávislá videohra','Indie'], ['videoherní simulátor','Simulace'], ['strategická videohra','Strategie'],
    ['závodní videohra','Závodní'], ['sportovní videohra','Sportovní'], ['logická videohra','Logická'],
    ['plošinová videohra','Plošinovka'], ['2d plošinovka','Plošinovka'], ['3d plošinovka','Plošinovka'],
    ['bojová videohra','Bojová'], ['střílečka','Střílečka'], ['střílečka z pohledu první osoby','FPS'],
    ['střílečka z pohledu třetí osoby','TPS'], ['akční hra na hrdiny','Akční RPG'], ['role playing','RPG'],
    ['casual','Nenáročná'], ['nenáročná videohra','Nenáročná'], ['massively multiplayer','MMO'],
    ['masivně multiplayerová online hra','MMO'], ['hororová videohra','Horor'], ['vizuální román','Vizuální novela'],
    ['rytmická videohra','Rytmická'], ['hudební videohra','Hudební'], ['fotbalová videohra','Fotbal'],
    ['hra o přežití','Survival'], ["hack and slash/beat 'em up",'Hack and slash']
  ]);
  if (exact.has(key)) return exact.get(key);
  if (/ice hockey|hockey/.test(key)) return 'Hokej';
  if (/association football|soccer/.test(key)) return 'Fotbal';
  if (/basketball/.test(key)) return 'Basketbal';
  if (/baseball/.test(key)) return 'Baseball';
  if (/racing|motorsport/.test(key)) return 'Závodní';
  if (/action.+role-playing|role-playing.+action/.test(key)) return 'Akční RPG';
  if (/role-playing|\brpg\b/.test(key)) return 'RPG';
  if (/first-person shooter/.test(key)) return 'FPS';
  if (/third-person shooter/.test(key)) return 'TPS';
  if (/shooter/.test(key)) return 'Střílečka';
  if (/survival horror/.test(key)) return 'Survival horor';
  if (/horror/.test(key)) return 'Horor';
  if (/action-adventure/.test(key)) return 'Akční adventura';
  if (/adventure/.test(key)) return 'Adventura';
  if (/action/.test(key)) return 'Akční';
  if (/platform/.test(key)) return 'Plošinovka';
  if (/puzzle/.test(key)) return 'Logická';
  if (/simulation/.test(key)) return 'Simulace';
  if (/strategy/.test(key)) return 'Strategie';
  if (/sports?/.test(key)) return 'Sportovní';
  const cleaned = raw
    .replace(/\s+video game genre$/i, '')
    .replace(/\s+video game$/i, '')
    .replace(/\s+game genre$/i, '')
    .replace(/\s+game$/i, '')
    .trim();
  return cleaned ? cleaned.charAt(0).toLocaleUpperCase('cs') + cleaned.slice(1) : raw;
}

export { platformIcon };
export function releaseCountdown(day) {
  if (!day) return null;
  const target = new Date(`${day}T00:00:00`);
  const ms = target - new Date();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / 3600000);
  if (hours < 48) return `za ${hours} h`;
  const days = Math.ceil(ms / 86400000);
  if (days <= 90) return `za ${days} dní`;
  return null;
}

export function releaseText(row) {
  if (row.day) return formatDate(row.day);
  return row.window || row.game.announcedWindow || 'TBA';
}

function precisionLabel(row) {
  const precision = String(row.precision || (row.day ? 'day' : 'unknown')).toLowerCase();
  if (precision === 'month') return 'Oznámený měsíc';
  if (/^q[1-4]$|quarter|quarterly/.test(precision)) return 'Oznámené čtvrtletí';
  if (precision === 'year') return 'Oznámený rok';
  if (precision === 'unknown' || !row.day) return 'Datum zatím neoznámeno';
  return 'Přesné datum';
}

function coverMarkup(game) {
  const cover = safeUrl(game.cover);
  if (!cover) return `<div class="game-card__cover" aria-hidden="true"><div class="game-card__gradient"></div></div>`;
  return `<div class="game-card__cover"><img src="${escapeHtml(cover)}" alt="Obal hry ${escapeHtml(game.name)}" loading="lazy" decoding="async" width="360" height="480"><div class="game-card__gradient"></div></div>`;
}

function serviceBadges(game, compact = false, excluded = [], allowed = null) {
  const skip = new Set(excluded);
  const services = [];
  const visible = key => !allowed || allowed.has(key);
  if (game.subscriptions?.gamePass && !skip.has('gamepass') && visible('gamepass')) services.push(['Game Pass','gamepass']);
  if (game.subscriptions?.cloudGaming && !skip.has('cloud') && visible('cloud')) services.push(['Xbox Cloud','cloud']);
  if (game.subscriptions?.eaPlay && !skip.has('eaplay') && visible('eaplay')) services.push(['EA Play','eaplay']);
  if (game.subscriptions?.psPlus && !skip.has('psplus') && visible('psplus')) services.push(['PS Plus','psplus']);
  if (game.subscriptions?.geforceNow && !skip.has('gfn') && visible('gfn')) services.push(['GeForce NOW','gfn']);
  if (!services.length) return '';
  return `<span class="service-badges ${compact ? 'service-badges--compact' : ''}">${services.map(([label, key]) => `<span class="service-badge service-badge--${key}">${serviceIcon(key, { className:'brand-icon--service' })}<span>${escapeHtml(label)}</span></span>`).join('')}</span>`;
}

export function rowCard(row, watched) {
  const game = row.game;
  const countdown = releaseCountdown(row.day);
  const rating = game.rating ? Math.round(game.rating) : 0;
  const platforms = row.platforms.slice(0,3).map(p => {
    const key = p.group || p.name || p.abbreviation || '';
    return `<span class="platform-tag">${platformIcon(key, { className:'brand-icon--tag' })}<span>${escapeHtml(p.abbreviation || p.name)}</span></span>`;
  }).join('');
  const releaseState = row.day ? (row.day >= todayLocal() ? 'Nadcházející' : 'Vydáno') : (row.window || game.announcedWindow || 'TBA');
  const visibleServices = serviceKindsForRow(row);
  const extraBadges = [
    row.onlineResult ? '<span class="badge badge--online">Nalezeno online</span>' : '',
    game.earlyAccess ? '<span class="badge badge--early">Early Access</span>' : '',
    game.scale ? `<span class="badge badge--scale">${escapeHtml(game.scale)}</span>` : '',
    game.subscriptions?.gamePass && (!visibleServices || visibleServices.has('gamepass'))
      ? `<span class="service-badge service-badge--gamepass card-service-badge">${serviceIcon('gamepass', { className:'brand-icon--service' })}<span>Game Pass</span></span>`
      : ''
  ].filter(Boolean).join('');
  const livePlatforms = JSON.stringify((row.platforms || []).map(p => p.name || p.abbreviation || '').filter(Boolean));
  return `<article class="game-card" data-row-key="${escapeHtml(row.key)}" data-live-game-id="${escapeHtml(String(game.id || ''))}" data-live-igdb-id="${escapeHtml(String(game.igdbId || ''))}" data-live-title="${escapeHtml(game.name)}" data-live-platforms="${escapeHtml(livePlatforms)}">
    <button class="game-card__button" type="button" data-open-game="${escapeHtml(row.key)}" aria-label="Detail hry ${escapeHtml(game.name)}">
      ${coverMarkup(game)}
      <span class="card-badges"><span class="badge ${row.day && row.day < todayLocal() ? 'badge--released' : 'badge--soon'}" title="${escapeHtml(precisionLabel(row))}">${escapeHtml(countdown || releaseState)}</span>${!row.day || row.precision !== 'day' ? `<span class="badge badge--precision">${escapeHtml(precisionLabel(row))}</span>` : ''}${extraBadges}</span>
      <span class="game-card__body">
        <span class="game-card__title">${escapeHtml(game.name)}</span>
        <span class="game-card__meta"><time class="game-card__date" ${row.day ? `datetime="${row.day}"` : ''}>${escapeHtml(releaseText(row))}</time>${rating ? `<span class="rating">★ ${rating}%</span>` : ''}</span>
        <span class="card-platforms">${platforms}</span>
        ${cardLivePrices(row)}
        ${serviceBadges(game, true, ['gamepass'], visibleServices)}
      </span>
    </button>
    <div class="game-card__actions">
      ${row.day ? `<button class="card-action" type="button" data-calendar="${escapeHtml(row.key)}">📅 Kalendář</button>` : '<span></span>'}
      <button class="card-action watch-btn ${watched ? 'is-active' : ''}" type="button" data-watch="${escapeHtml(String(game.id))}" aria-pressed="${watched}" title="${watched ? 'Odebrat ze sledovaných' : 'Sledovat hru'}">${watched ? '♥' : '♡'}</button>
    </div>
  </article>`;
}

export function fallbackLinks(game) {
  const q = encodeURIComponent(game.name);
  return {
    steam: game.links?.steam || `https://store.steampowered.com/search/?term=${q}`,
    epic: game.links?.epic || `https://store.epicgames.com/en-US/browse?q=${q}&sortBy=relevancy&sortDir=DESC&count=40`,
    reddit: game.links?.reddit || `https://www.reddit.com/search/?q=${q}`,
    youtube: game.links?.youtube || `https://www.youtube.com/results?search_query=${q}+trailer`,
    database: game.links?.igdb || game.igdbUrl || '',
    official: game.links?.official || '',
    wikipedia: game.links?.wikipedia || '',
    playstation: game.links?.playstation || `https://store.playstation.com/en-cz/search/${q}`,
    xbox: game.links?.xbox || `https://www.xbox.com/cs-CZ/Search/Results?q=${q}`,
    nintendo: game.links?.nintendo || `https://www.nintendo.com/us/search/#q=${q}`,
    meta: `https://www.meta.com/experiences/search/?q=${q}`
  };
}

function linkIcon(kind) {
  if (['steam','epic','playstation','xbox','nintendo','meta'].includes(kind)) return sharedStoreIcon(kind);
  if (kind === 'youtube') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 8.2v7.6l6.2-3.8-6.2-3.8Z" fill="currentColor"/><rect x="3" y="5.5" width="18" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'official') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'reddit') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.2" cy="12" r=".9" fill="currentColor"/><circle cx="14.8" cy="12" r=".9" fill="currentColor"/><path d="M9 15c1.8 1.1 4.2 1.1 6 0M14.2 6.8l1-3.1 3.2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  if (kind === 'database') return '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'wikipedia') return '<span class="store-link__monogram">W</span>';
  return '<span class="store-link__monogram">↗</span>';
}

function linkButton(label, url, kind) {
  const safe = safeUrl(url);
  if (!safe) return '';
  return `<a class="store-link store-link--${escapeHtml(kind)}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer"><span class="store-link__icon">${linkIcon(kind)}</span><span class="store-link__label">${escapeHtml(label)}</span><svg class="store-link__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8m-6 0h6v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
}

function platformStoreLinks(row, links) {
  const groups = new Set(row.platformGroups);
  const names = row.platforms.map(platform => String(platform.name || '').toLowerCase());
  const items = [];
  const pricedLabel = (label, kind) => {
    const price = livePriceForStore(row, kind);
    return price ? `${label} · ${price}` : label;
  };
  const add = (label, url, kind, includePrice = true) => {
    const button = linkButton(includePrice ? pricedLabel(label, kind) : label, url, kind);
    if (button && !items.includes(button)) items.push(button);
  };
  if (groups.has('PC')) {
    add(row.game.links?.steam ? 'Steam' : 'Hledat na Steam', links.steam, 'steam', Boolean(row.game.links?.steam));
    add(row.game.links?.epic ? 'Epic Games' : 'Hledat na Epic', links.epic, 'epic', Boolean(row.game.links?.epic));
    add(row.game.links?.xbox ? 'Microsoft / Xbox Store' : 'Hledat na Microsoft / Xbox', links.xbox, 'xbox', Boolean(row.game.links?.xbox));
  }
  if (groups.has('PS5') || groups.has('PS4')) add('PlayStation Store', links.playstation, 'playstation');
  if (groups.has('Xbox Series') || groups.has('Xbox One') || groups.has('Xbox 360')) add('Xbox Store', links.xbox, 'xbox');
  if (groups.has('Switch') || groups.has('Switch 2')) add('Nintendo Store', links.nintendo, 'nintendo');
  if (groups.has('VR')) {
    let matched = false;
    if (names.some(name => /quest|rift/.test(name))) { add('Meta Quest Store', links.meta, 'meta', false); matched = true; }
    if (names.some(name => /playstation vr|ps vr/.test(name))) { add('PlayStation Store', links.playstation, 'playstation'); matched = true; }
    if (names.some(name => /steamvr|windows|pc/.test(name))) { add('Steam', links.steam, 'steam'); matched = true; }
    if (!matched) add('Meta Quest Store', links.meta, 'meta', false);
  }
  return items.join('');
}

function generatedDescription(row) {
  const game = row.game;
  const genres = [...new Set((game.genres || []).map(formatGenre).filter(Boolean))];
  const developers = game.developers || [];
  const platformNames = row.platforms.map(platform => platform.name).filter(Boolean);
  let text = `${game.name} je videohra`;
  if (genres.length) text += ` v žánru ${genres.slice(0,2).join(' / ')}`;
  if (developers.length) text += ` od studia ${developers[0]}`;
  if (platformNames.length) text += ` pro ${platformNames.join(', ')}`;
  return `${text}. ${row.day ? `Datum vydání: ${formatDate(row.day)}.` : `Termín vydání: ${row.window || game.announcedWindow || 'TBA'}.`}`;
}

function shortDescription(value, maxLength = 520) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const head = text.slice(0, maxLength);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd > maxLength * 0.55) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.lastIndexOf(' ');
  return `${head.slice(0, wordEnd > 0 ? wordEnd : maxLength)}…`;
}

function peopleFact(label, values, type) {
  if (!values?.length) return '';
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong class="fact-links">${values.map(value => `<button type="button" class="text-filter-link" data-filter-company="${type}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('<span class="fact-sep">, </span>')}</strong></div>`;
}

function seriesFact(series) {
  if (!series?.length) return '';
  return `<div class="fact"><span>Série</span><strong class="fact-links">${series.map(value => `<button type="button" class="text-filter-link" data-filter-series="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('<span class="fact-sep">, </span>')}</strong></div>`;
}

function regionalMarkup(game) {
  if (!game.regionalReleases?.length) return '';
  const items = game.regionalReleases.slice(0, 8).map(item => `<span class="region-release"><strong>${escapeHtml(item.region || 'Region')}</strong><span>${escapeHtml(item.label || (item.day ? formatDate(item.day) : 'TBA'))}</span></span>`).join('');
  return `<section class="detail-subsection"><p class="detail-section-label">Regionální vydání</p><div class="region-grid">${items}</div></section>`;
}

function mediaMarkup(game) {
  const trailerId = String(game.trailerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const trailerUrl = safeUrl(game.trailerUrl);
  const poster = safeUrl(game.trailerPoster);
  let trailer = '';
  if (trailerId) {
    trailer = `<div class="detail-video"><iframe src="https://www.youtube-nocookie.com/embed/${trailerId}" title="Trailer ${escapeHtml(game.name)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  } else if (trailerUrl) {
    trailer = `<div class="detail-video"><video controls preload="metadata" ${poster ? `poster="${escapeHtml(poster)}"` : ''}><source src="${escapeHtml(trailerUrl)}"></video></div>`;
  }
  const screenshots = (game.screenshots || []).slice(0, 8).map(item => {
    const full = safeUrl(item.full);
    const thumb = safeUrl(item.thumb || item.full);
    if (!full || !thumb) return '';
    return `<button class="gallery-item" type="button" data-gallery-image="${escapeHtml(full)}" aria-label="Otevřít screenshot"><img src="${escapeHtml(thumb)}" alt="Screenshot ze hry ${escapeHtml(game.name)}" loading="lazy" decoding="async"></button>`;
  }).filter(Boolean).join('');
  if (!trailer && !screenshots) return '';
  return `<section class="detail-media-section">${trailer ? `<p class="detail-section-label">Trailer</p>${trailer}` : ''}${screenshots ? `<p class="detail-section-label detail-section-label--gallery">Screenshoty</p><div class="screenshot-rail">${screenshots}</div>` : ''}</section>`;
}

export function gameDialogHtml(row, watched) {
  const game = row.game;
  const links = fallbackLinks(game);
  const countdown = releaseCountdown(row.day);
  const cover = safeUrl(game.cover);
  const summary = shortDescription(game.summary || game.storyline || generatedDescription(row));
  const genreLabels = [...new Set((game.genres || []).map(formatGenre).filter(Boolean))];
  const rating = game.rating ? `${Math.round(game.rating)} %${game.ratingCount ? ` (${formatter.format(game.ratingCount)})` : ''}` : '';
  const storeLinks = platformStoreLinks(row, links);
  const databaseLabel = /rawg\.io/i.test(links.database || '') ? 'RAWG' : 'IGDB';
  const moreLinks = [
    linkButton('Oficiální web', links.official, 'official'),
    linkButton(databaseLabel, links.database, 'database'),
    linkButton('Wikipedia', links.wikipedia, 'wikipedia'),
    linkButton('Reddit', links.reddit, 'reddit'),
    !game.trailerId && !game.trailerUrl ? linkButton('YouTube', links.youtube, 'youtube') : ''
  ].filter(Boolean).join('');
  const flags = [
    game.earlyAccess ? '<span class="detail-flag detail-flag--early">Early Access</span>' : '',
    game.scale ? `<span class="detail-flag">${escapeHtml(game.scale)}</span>` : '',
    row.precision && row.precision !== 'day' ? `<span class="detail-flag">Termín: ${escapeHtml(row.window || game.announcedWindow || row.precision)}</span>` : ''
  ].filter(Boolean).join('');
  const facts = [
    peopleFact('Vývojář', game.developers, 'developer'),
    peopleFact('Vydavatel', game.publishers, 'publisher'),
    seriesFact(game.series),
    `<div class="fact"><span>Jistota termínu</span><strong>${escapeHtml(precisionLabel(row))}</strong></div>`,
    rating ? `<div class="fact"><span>Hodnocení</span><strong>${escapeHtml(rating)}</strong></div>` : ''
  ].filter(Boolean).join('');

  return `<div class="detail-hero">
    <div class="detail-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="Obal hry ${escapeHtml(game.name)}" decoding="async">` : ''}</div>
    <div class="detail-main">
      <p class="detail-kicker">${escapeHtml(countdown || (row.day ? (row.day >= todayLocal() ? 'Nadcházející vydání' : 'Vydaná hra') : 'Termín zatím není přesný'))}</p>
      <h2>${escapeHtml(game.name)}</h2>
      ${game.aliases?.length ? `<p class="detail-aliases">Také: ${escapeHtml(game.aliases.slice(0,4).join(' · '))}</p>` : ''}
      <div class="detail-meta">
        <span class="badge">📅 ${escapeHtml(releaseText(row))}</span>
        ${row.platforms.map(p => `<span class="badge">${escapeHtml(p.name)}</span>`).join('')}
        ${game.rating ? `<span class="badge">★ ${Math.round(game.rating)} %</span>` : ''}
      </div>
      ${flags ? `<div class="detail-flags">${flags}</div>` : ''}
      ${serviceBadges(game, false, [], serviceKindsForRow(row))}
      <p class="detail-summary">${escapeHtml(summary)}</p>
      ${genreLabels.length ? `<div class="detail-genres"><span class="detail-section-label">Žánry</span><div class="genre-chips">${genreLabels.map(genre => `<button type="button" class="genre-chip" data-dialog-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`).join('')}</div></div>` : ''}
      ${facts ? `<div class="detail-facts">${facts}</div>` : ''}
      ${regionalMarkup(game)}
      <div class="detail-actions">
        ${row.day ? `<button class="primary-btn" type="button" data-dialog-calendar="${escapeHtml(row.key)}">📅 Přidat do kalendáře</button>` : ''}
        <button class="secondary-btn" type="button" data-dialog-watch="${escapeHtml(String(game.id))}">${watched ? '♥ Sledováno' : '♡ Sledovat'}</button>
        <button class="secondary-btn" type="button" data-dialog-share="${escapeHtml(row.key)}">↗ Sdílet hru</button>
      </div>
      ${mediaMarkup(game)}
      ${storeLinks ? `<section class="detail-link-section detail-link-section--stores" aria-label="Obchody pro toto vydání"><p class="detail-section-label">Kde hru najít</p><div class="detail-store-grid">${storeLinks}</div></section>` : ''}
      ${moreLinks ? `<section class="detail-link-section" aria-label="Další odkazy"><p class="detail-section-label">Další odkazy</p><div class="detail-more-links">${moreLinks}</div></section>` : ''}
    </div>
  </div>`;
}
