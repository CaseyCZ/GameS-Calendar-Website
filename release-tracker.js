const $ = id => document.getElementById(id);
const API_URL = globalThis.location?.hostname?.endsWith('.github.io') ? null : '/games-api/changes';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function releaseLabel(value) {
  const items = Array.isArray(value) ? value : value?.releases;
  if (!Array.isArray(items) || !items.length) return 'bez oznámeného termínu';
  const first = items[0] || {};
  if (first.day) return new Date(`${first.day}T12:00:00Z`).toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  return first.window || 'bez oznámeného termínu';
}

function priceSummary(value) {
  const entries = Object.entries(value || {}).filter(([, price]) => price && (price.currentText || price.current != null));
  if (!entries.length) return 'bez ceny';
  return entries.map(([provider, price]) => {
    const label = provider === 'microsoft' ? 'Xbox' : provider === 'playstation' ? 'PlayStation' : provider === 'nintendo' ? 'Nintendo' : provider === 'steam' ? 'Steam' : provider;
    const text = String(price.currentText || '').trim();
    if (text) return `${label}: ${text}`;
    const current = Number(price.current);
    const currency = String(price.currency || '').trim();
    return Number.isFinite(current) ? `${label}: ${current}${currency ? ` ${currency}` : ''}` : label;
  }).join(' · ');
}

function subscriptionSummary(value) {
  const s = value || {};
  const items = [];
  if (s.gamePassConsole) items.push('Game Pass Console');
  if (s.gamePassPc) items.push('PC Game Pass');
  if (s.cloudGaming) items.push('Xbox Cloud Gaming');
  if (s.gamePass && !s.gamePassConsole && !s.gamePassPc) items.push('Game Pass');
  if (s.psPlus) items.push('PS Plus');
  if (s.geforceNow) items.push('GeForce NOW');
  if (s.eaPlay) items.push('EA Play');
  return items.length ? items.join(', ') : 'bez předplatného';
}

function itemText(item) {
  if (item.field === 'gameAdded') return { badge: 'Nová hra', text: `Přidána do katalogu · ${releaseLabel(item.newValue)}`, kind: 'new' };
  if (item.field === 'gameRemoved') return { badge: 'Odebráno', text: 'Hra už není v aktuálním katalogu', kind: 'removed' };
  if (item.field === 'prices') return { badge: 'Cena', text: `${priceSummary(item.oldValue)} → ${priceSummary(item.newValue)}`, kind: 'price' };
  if (item.field === 'subscriptions') return { badge: 'Předplatné', text: `${subscriptionSummary(item.oldValue)} → ${subscriptionSummary(item.newValue)}`, kind: 'subscription' };
  if (item.field === 'earlyAccess') {
    if (item.oldValue === true && item.newValue === false) return { badge: 'Early Access', text: 'Early Access byl ukončen', kind: 'early' };
    if (item.oldValue === false && item.newValue === true) return { badge: 'Early Access', text: 'Hra vstoupila do Early Access', kind: 'early' };
    return { badge: 'Early Access', text: 'Stav Early Access se změnil', kind: 'early' };
  }
  return { badge: 'Změna termínu', text: `${releaseLabel(item.oldValue)} → ${releaseLabel(item.newValue)}`, kind: 'date' };
}

function itemHref(item) {
  const query = new URLSearchParams({ game: String(item.game?.id || item.gameKey) });
  if (String(item.game?.id || '').startsWith('igdb-')) query.set('q', item.game?.name || '');
  return `${location.pathname}?${query}`;
}

function render(items, trackingSince) {
  const list = $('release-changes-list');
  if (!items.length) {
    const since = trackingSince ? new Date(trackingSince).toLocaleDateString('cs-CZ') : 'dneška';
    list.innerHTML = `<div class="release-changes__empty"><strong>Zatím žádná změna</strong><span>Termíny sledujeme od ${escapeHtml(since)}.</span></div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const copy = itemText(item);
    const when = new Date(item.changedAt).toLocaleString('cs-CZ', { dateStyle:'medium', timeStyle:'short' });
    const cover = item.game?.cover ? `<img src="${escapeHtml(item.game.cover)}" alt="" loading="lazy" decoding="async">` : '<span class="release-change__cover"></span>';
    return `<a class="release-change release-change--${copy.kind}" href="${escapeHtml(itemHref(item))}">
      ${cover}<span class="release-change__body"><span class="release-change__badge">${copy.badge}</span>
      <strong>${escapeHtml(item.game?.name || item.gameKey)}</strong><span>${escapeHtml(copy.text)}</span><time>${escapeHtml(when)}</time></span>
    </a>`;
  }).join('');
}

async function loadChanges(type = 'all') {
  if (!API_URL) {
    $('stat-changes').textContent = '–';
    render([], null);
    return;
  }
  try {
    const response = await fetch(`${API_URL}?days=30&type=${encodeURIComponent(type)}&limit=100`, { headers: { Accept:'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    $('stat-changes').textContent = new Intl.NumberFormat('cs-CZ').format(data.count || 0);
    render(data.items || [], data.trackingSince);
  } catch (error) {
    console.warn('Release changes:', error);
    $('release-changes-list').innerHTML = '<div class="release-changes__empty"><strong>Změny se nepodařilo načíst</strong><span>Zkuste to znovu za chvíli.</span></div>';
  }
}

const toggle = $('changes-toggle');
const panel = $('release-changes');
if (toggle && panel) {
  loadChanges();
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.classList.toggle('is-active', !panel.hidden);
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) panel.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-change-type]');
    if (!button) return;
    panel.querySelectorAll('[data-change-type]').forEach(item => item.classList.toggle('is-active', item === button));
    $('release-changes-list').innerHTML = '<p class="muted">Načítám změny…</p>';
    loadChanges(button.dataset.changeType);
  });
}
