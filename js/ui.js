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

function linkButton(label, url) {
  const safe = safeUrl(url);
  return safe ? `<a class="store-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : '';
}

function platformStoreLinks(row, links) {
  const groups = new Set(row.platforms.map(platform => platform.group).filter(Boolean));
  const names = row.platforms.map(platform => String(platform.name || '').toLowerCase());
  const items = [];
  const add = (label, url) => {
    const button = linkButton(label, url);
    if (button && !items.includes(button)) items.push(button);
  };

  if (groups.has('PC')) {
    add(row.game.links?.steam ? 'Steam' : 'Hledat na Steam', links.steam);
    add(row.game.links?.epic ? 'Epic Games' : 'Hledat na Epic', links.epic);
  }
  if (groups.has('PS5')) add('PlayStation Store', links.playstation);
  if (groups.has('Xbox Series')) add('Xbox Store', links.xbox);
  if (groups.has('Switch') || groups.has('Switch 2')) add('Nintendo Store', links.nintendo);
  if (groups.has('VR')) {
    let matched = false;
    if (names.some(name => /quest|rift/.test(name))) { add('Meta Quest Store', links.meta); matched = true; }
    if (names.some(name => /playstation vr|ps vr/.test(name))) { add('PlayStation Store', links.playstation); matched = true; }
    if (names.some(name => /steamvr|windows|pc/.test(name))) { add('Steam', links.steam); matched = true; }
    if (!matched) add('Meta Quest Store', links.meta);
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
  if (genres.length) text += ` v žánru ${genres.slice(0,2).join(' / ')}`;
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
  const genres = game.genres.join(', ');
  const devs = game.developers.join(', ');
  const publishers = game.publishers.join(', ');
  const rating = game.rating ? `${Math.round(game.rating)} %${game.ratingCount ? ` (${formatter.format(game.ratingCount)})` : ''}` : '';
  const facts = [
    factMarkup('Žánry', genres),
    factMarkup('Vývojář', devs),
    factMarkup('Vydavatel', publishers),
    factMarkup('Hodnocení', rating)
  ].filter(Boolean).join('');
  const storeLinks = platformStoreLinks(row, links);
  const databaseLabel = /rawg\.io/i.test(links.database || '') ? 'RAWG' : 'IGDB';

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
      ${facts ? `<div class="detail-facts">${facts}</div>` : ''}
      <div class="detail-actions">
        <button class="primary-btn" type="button" data-dialog-calendar="${escapeHtml(row.key)}">📅 Přidat do kalendáře</button>
        <button class="secondary-btn" type="button" data-dialog-watch="${escapeHtml(String(game.id))}">${watched ? '♥ Sledováno' : '♡ Sledovat'}</button>
        ${game.trailerId ? `<button class="secondary-btn" type="button" data-trailer="${escapeHtml(game.trailerId)}">▶ Trailer</button>` : linkButton('▶ YouTube', links.youtube)}
      </div>
      ${storeLinks ? `<div class="detail-links" aria-label="Obchody pro toto vydání">${storeLinks}</div>` : ''}
      <div class="detail-links" aria-label="Další odkazy">
        ${linkButton('Oficiální web', links.official)}
        ${linkButton(databaseLabel, links.database)}
        ${linkButton('Reddit', links.reddit)}
      </div>
    </div>
  </div>`;
}