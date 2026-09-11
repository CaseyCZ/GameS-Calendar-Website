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

export function formatDate(day, options = { day:'2-digit', month:'2-digit', year:'numeric' }) {
  if (!day) return '—';
  return new Intl.DateTimeFormat('cs-CZ', { ...options, timeZone:'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function formatMonth(day) {
  const [year, month] = day.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function formatGenre(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLocaleLowerCase('en');

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
    ['turn-based tactics','Tahová taktika'], ['tactical role-playing game','Taktické RPG']
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

export function platformIcon(key) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true"';
  if (key === 'PC') return `<svg ${common}><path d="M3 5.5 10.5 4v7H3v-5.5Zm9-1.8L21 2v9h-9V3.7ZM3 13h7.5v7L3 18.5V13Zm9 0h9v9l-9-1.7V13Z" fill="currentColor"/></svg>`;
  if (key === 'Xbox Series') return `<svg ${common}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 7.8c3 1.2 6 4.6 8.8 9.2M16.5 7.8c-3 1.2-6 4.6-8.8 9.2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;
  if (key === 'PS5') return `<svg ${common}><path d="M8 5v14m0-14c4 0 7 1 7 4.2 0 2.6-2.3 3.6-5.2 3.6M4 16c3-1.8 6-2.4 9.2-2.5 3.2-.1 5.5.6 6.8 1.6-2.7 1.2-5.4 2-8 2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  if (key === 'Switch' || key === 'Switch 2') return `<svg ${common}><path d="M8.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.5V3Zm7 0H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2.5V3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.4" cy="8" r="1" fill="currentColor"/><circle cx="17.6" cy="15.7" r="1" fill="currentColor"/></svg>`;
  if (key === 'VR') return `<svg ${common}><path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5H15l-2-2h-2l-2 2H6.5A2.5 2.5 0 0 1 4 14.5v-5Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 11.5h2m-1-1v2m5-1h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  return `<span aria-hidden="true">🎮</span>`;
}

export function releaseCountdown(day) {
  const target = new Date(`${day}T00:00:00`);
  const ms = target - new Date();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / 3600000);
  if (hours < 48) return `za ${hours} h`;
  const days = Math.ceil(ms / 86400000);
  if (days <= 90) return `za ${days} dní`;
  return null;
}

function coverMarkup(game) {
  const cover = safeUrl(game.cover);
  if (!cover) return `<div class="game-card__cover" aria-hidden="true"><div class="game-card__gradient"></div></div>`;
  return `<div class="game-card__cover"><img src="${escapeHtml(cover)}" alt="Obal hry ${escapeHtml(game.name)}" loading="lazy" decoding="async" width="360" height="480"><div class="game-card__gradient"></div></div>`;
}

export function rowCard(row, watched) {
  const game = row.game;
  const countdown = releaseCountdown(row.day);
  const rating = game.rating ? Math.round(game.rating) : 0;
  const platforms = row.platforms.slice(0,3).map(p => `<span class="platform-tag">${escapeHtml(p.abbreviation || p.name)}</span>`).join('');
  return `<article class="game-card" data-row-key="${escapeHtml(row.key)}">
    <button class="game-card__button" type="button" data-open-game="${escapeHtml(row.key)}" aria-label="Detail hry ${escapeHtml(game.name)}">
      ${coverMarkup(game)}
      <span class="card-badges"><span class="badge ${row.day >= todayLocal() ? 'badge--soon' : 'badge--released'}">${countdown || (row.day >= todayLocal() ? 'Nadcházející' : 'Vydáno')}</span></span>
      <span class="game-card__body">
        <span class="game-card__title">${escapeHtml(game.name)}</span>
        <span class="game-card__meta"><time class="game-card__date" datetime="${row.day}">${formatDate(row.day)}</time>${rating ? `<span class="rating">★ ${rating}%</span>` : ''}</span>
        <span class="card-platforms">${platforms}</span>
      </span>
    </button>
    <div class="game-card__actions">
      <button class="card-action" type="button" data-calendar="${escapeHtml(row.key)}">📅 Kalendář</button>
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
    playstation: `https://store.playstation.com/en-cz/search/${q}`,
    xbox: `https://www.xbox.com/cs-CZ/Search/Results?q=${q}`,
    nintendo: `https://www.nintendo.com/us/search/#q=${q}`,
    meta: `https://www.meta.com/experiences/search/?q=${q}`
  };
}

function storeIcon(kind) {
  if (kind === 'playstation') return platformIcon('PS5');
  if (kind === 'xbox') return platformIcon('Xbox Series');
  if (kind === 'nintendo') return platformIcon('Switch');
  if (kind === 'meta') return platformIcon('VR');
  if (kind === 'steam') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="15" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.8" cy="7.5" r="2.7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m11.7 13.4 3.1-3.4M4 13.5l2.7 1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  if (kind === 'youtube') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 8.2v7.6l6.2-3.8-6.2-3.8Z" fill="currentColor"/><rect x="3" y="5.5" width="18" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'official') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'reddit') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.2" cy="12" r=".9" fill="currentColor"/><circle cx="14.8" cy="12" r=".9" fill="currentColor"/><path d="M9 15c1.8 1.1 4.2 1.1 6 0M14.2 6.8l1-3.1 3.2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="19.2" cy="5" r="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  if (kind === 'database') return '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  if (kind === 'epic') return '<span class="store-link__monogram" aria-hidden="true">E</span>';
  return '<span class="store-link__monogram" aria-hidden="true">↗</span>';
}

function linkButton(label, url, kind = 'more') {
  const safe = safeUrl(url);
  return safe ? `<a class="store-link store-link--${escapeHtml(kind)}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer"><span class="store-link__icon">${storeIcon(kind)}</span><span class="store-link__label">${escapeHtml(label)}</span><svg class="store-link__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : '';
}

function platformStoreLinks(row, links) {
  const groups = new Set(row.platforms.map(platform => platform.group).filter(Boolean));
  const names = row.platforms.map(platform => String(platform.name || '').toLowerCase());
  const items = [];
  const add = (label, url, kind) => {
    const button = linkButton(label, url, kind);
    if (button && !items.includes(button)) items.push(button);
  };

  if (groups.has('PC')) {
    add(row.game.links?.steam ? 'Steam' : 'Hledat na Steam', links.steam, 'steam');
    add(row.game.links?.epic ? 'Epic Games' : 'Hledat na Epic', links.epic, 'epic');
  }
  if (groups.has('PS5')) add('PlayStation Store', links.playstation, 'playstation');
  if (groups.has('Xbox Series')) add('Xbox Store', links.xbox, 'xbox');
  if (groups.has('Switch') || groups.has('Switch 2')) add('Nintendo Store', links.nintendo, 'nintendo');
  if (groups.has('VR')) {
    let matched = false;
    if (names.some(name => /quest|rift/.test(name))) { add('Meta Quest Store', links.meta, 'meta'); matched = true; }
    if (names.some(name => /playstation vr|ps vr/.test(name))) { add('PlayStation Store', links.playstation, 'playstation'); matched = true; }
    if (names.some(name => /steamvr|windows|pc/.test(name))) { add('Steam', links.steam, 'steam'); matched = true; }
    if (!matched) add('Meta Quest Store', links.meta, 'meta');
  }

  return items.join('');
}

function factMarkup(label, value) {
  if (!value) return '';
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function generatedDescription(row) {
  const game = row.game;
  const genres = game.genres || [];
  const developers = game.developers || [];
  const platformNames = row.platforms.map(platform => platform.name).filter(Boolean);
  let text = `${game.name} je videohra`;
  if (genres.length) text += ` v žánru ${genres.slice(0,2).map(formatGenre).join(' / ')}`;
  if (developers.length) text += ` od studia ${developers[0]}`;
  if (platformNames.length) text += ` pro ${platformNames.join(', ')}`;
  return `${text}. Datum vydání: ${formatDate(row.day)}.`;
}

function shortDescription(value, maxLength = 460) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const head = text.slice(0, maxLength);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd > maxLength * 0.55) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.lastIndexOf(' ');
  return `${head.slice(0, wordEnd > 0 ? wordEnd : maxLength)}…`;
}

export function gameDialogHtml(row, watched) {
  const game = row.game;
  const links = fallbackLinks(game);
  const countdown = releaseCountdown(row.day);
  const cover = safeUrl(game.cover);
  const summary = shortDescription(game.summary || game.storyline || generatedDescription(row));
  const genreLabels = [...new Set((game.genres || []).map(formatGenre).filter(Boolean))];
  const devs = game.developers.join(', ');
  const publishers = game.publishers.join(', ');
  const rating = game.rating ? `${Math.round(game.rating)} %${game.ratingCount ? ` (${formatter.format(game.ratingCount)})` : ''}` : '';
  const facts = [
    factMarkup('Vývojář', devs),
    factMarkup('Vydavatel', publishers),
    factMarkup('Hodnocení', rating)
  ].filter(Boolean).join('');
  const storeLinks = platformStoreLinks(row, links);
  const databaseLabel = /rawg\.io/i.test(links.database || '') ? 'RAWG' : 'IGDB';
  const moreLinks = [
    linkButton('Oficiální web', links.official, 'official'),
    linkButton(databaseLabel, links.database, 'database'),
    linkButton('Reddit', links.reddit, 'reddit'),
    !game.trailerId ? linkButton('YouTube', links.youtube, 'youtube') : ''
  ].filter(Boolean).join('');

  return `<div class="detail-hero">
    <div class="detail-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="Obal hry ${escapeHtml(game.name)}" decoding="async">` : ''}</div>
    <div class="detail-main">
      <p class="detail-kicker">${countdown ? escapeHtml(countdown) : (row.day >= todayLocal() ? 'Nadcházející vydání' : 'Vydaná hra')}</p>
      <h2>${escapeHtml(game.name)}</h2>
      <div class="detail-meta">
        <span class="badge">📅 ${formatDate(row.day)}</span>
        ${row.platforms.map(p => `<span class="badge">${escapeHtml(p.name)}</span>`).join('')}
        ${game.rating ? `<span class="badge">★ ${Math.round(game.rating)} %</span>` : ''}
      </div>
      <p class="detail-summary">${escapeHtml(summary)}</p>
      ${genreLabels.length ? `<div class="detail-genres"><span class="detail-section-label">Žánr</span><div class="genre-chips">${genreLabels.map(genre => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join('')}</div></div>` : ''}
      ${facts ? `<div class="detail-facts">${facts}</div>` : ''}
      <div class="detail-actions">
        <button class="primary-btn" type="button" data-dialog-calendar="${escapeHtml(row.key)}">📅 Přidat do kalendáře</button>
        <button class="secondary-btn" type="button" data-dialog-watch="${escapeHtml(String(game.id))}">${watched ? '♥ Sledováno' : '♡ Sledovat'}</button>
        ${game.trailerId ? `<button class="secondary-btn" type="button" data-trailer="${escapeHtml(game.trailerId)}">▶ Trailer</button>` : ''}
      </div>
      ${storeLinks ? `<section class="detail-link-section detail-link-section--stores" aria-label="Obchody pro toto vydání"><p class="detail-section-label">Kde hru najít</p><div class="detail-store-grid">${storeLinks}</div></section>` : ''}
      ${moreLinks ? `<section class="detail-link-section" aria-label="Další odkazy"><p class="detail-section-label">Další odkazy</p><div class="detail-more-links">${moreLinks}</div></section>` : ''}
    </div>
  </div>`;
}