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
    igdb: game.links?.igdb || game.igdbUrl || `https://www.igdb.com/search?type=1&q=${q}`,
    official: game.links?.official || ''
  };
}

function linkButton(label, url) {
  const safe = safeUrl(url);
  return safe ? `<a class="store-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : '';
}

export function gameDialogHtml(row, watched) {
  const game = row.game;
  const links = fallbackLinks(game);
  const countdown = releaseCountdown(row.day);
  const devs = game.developers.join(', ') || '—';
  const publishers = game.publishers.join(', ') || '—';
  const genres = game.genres.join(', ') || '—';
  const cover = safeUrl(game.cover);
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
      <p class="detail-summary">${escapeHtml(game.summary || game.storyline || 'Podrobnější popis zatím IGDB neposkytuje.')}</p>
      <div class="detail-facts">
        <div class="fact"><span>Žánry</span><strong>${escapeHtml(genres)}</strong></div>
        <div class="fact"><span>Vývojář</span><strong>${escapeHtml(devs)}</strong></div>
        <div class="fact"><span>Vydavatel</span><strong>${escapeHtml(publishers)}</strong></div>
        <div class="fact"><span>Hodnocení IGDB</span><strong>${game.rating ? `${Math.round(game.rating)} % (${formatter.format(game.ratingCount || 0)})` : '—'}</strong></div>
      </div>
      <div class="detail-actions">
        <button class="primary-btn" type="button" data-dialog-calendar="${escapeHtml(row.key)}">📅 Přidat do kalendáře</button>
        <button class="secondary-btn" type="button" data-dialog-watch="${escapeHtml(String(game.id))}">${watched ? '♥ Sledováno' : '♡ Sledovat'}</button>
        ${game.trailerId ? `<button class="secondary-btn" type="button" data-trailer="${escapeHtml(game.trailerId)}">▶ Trailer</button>` : linkButton('▶ YouTube', links.youtube)}
      </div>
      <div class="detail-links">
        ${linkButton('Oficiální web', links.official)}
        ${linkButton(game.links?.steam ? 'Steam' : 'Hledat na Steam', links.steam)}
        ${linkButton(game.links?.epic ? 'Epic Games' : 'Hledat na Epic', links.epic)}
        ${linkButton('IGDB', links.igdb)}
        ${linkButton('Reddit', links.reddit)}
      </div>
    </div>
  </div>`;
}
