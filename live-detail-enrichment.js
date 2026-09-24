import { serviceIcon, storeIcon } from './js/icons.js';
import { fetchApi } from './js/api.js';

(() => {
  const dialog = document.getElementById('game-dialog');
  const content = document.getElementById('dialog-content');
  if (!dialog || !content || window.__gamesLiveDetailEnrichment) return;
  window.__gamesLiveDetailEnrichment = true;

  const cache = new Map();
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const SCREEN_CACHE_TTL_MS = 10 * 60 * 1000;
  const screenCache = new Map();
  const screenPending = new Set();
  let screenObserver = null;
  let screenTimer = 0;

  function cachedPayload(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (!entry.fetchedAt || Date.now() - entry.fetchedAt >= CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return entry.payload || null;
  }

  function cachePayload(key, payload) {
    cache.set(key, { payload, fetchedAt: Date.now() });
  }

  let pendingTitle = '';
  let timer = 0;

  const PROVIDER_LABELS = {
    igdb: 'IGDB',
    steam: 'Steam · PC',
    epic: 'Epic Games Store',
    microsoft: 'Microsoft / Xbox Store',
    playstation: 'PlayStation Store',
    nintendo: 'Nintendo eShop',
    geforceNow: 'GeForce NOW'
  };

  function clean(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function currentTitle() {
    return clean(content.querySelector('.detail-main h2')?.textContent);
  }

  function currentGameId() {
    const dialogId = clean(dialog.dataset.gameId);
    if (dialogId) return dialogId;
    const queryId = clean(new URLSearchParams(location.search).get('game'));
    if (queryId) return queryId;
    const rowKey = clean(dialog.dataset.rowKey);
    if (!rowKey) return '';
    if (rowKey.startsWith('online:')) return rowKey.split(':')[1] || '';
    const firstColon = rowKey.indexOf(':');
    return firstColon > 0 ? rowKey.slice(0, firstColon) : rowKey;
  }

  function currentIgdbId() {
    return clean(dialog.dataset.igdbId);
  }

  function currentEnrichmentKey() {
    const igdbId = currentIgdbId();
    if (igdbId) return `igdb:${igdbId}`;
    const gameId = currentGameId();
    const title = currentTitle();
    return `game:${gameId}:${title.toLowerCase()}`;
  }

  function platformTexts() {
    try {
      const parsed = JSON.parse(dialog.dataset.livePlatforms || '[]');
      if (Array.isArray(parsed) && parsed.length) return parsed.map(clean).filter(Boolean);
    } catch {}
    return [...content.querySelectorAll('.detail-meta .badge')]
      .map(node => clean(node.textContent))
      .filter(text => text && !text.includes('📅') && !text.includes('★'));
  }

  function providersForPlatforms(platforms) {
    const text = platforms.join(' ').toLowerCase();
    const names = new Set(['igdb']);
    if (/\bpc\b|windows/.test(text)) {
      names.add('steam');
      names.add('epic');
      names.add('microsoft');
      names.add('geforceNow');
    }
    if (/xbox/.test(text)) {
      names.add('microsoft');
      names.add('geforceNow');
    }
    if (/ps4|ps5|playstation/.test(text)) names.add('playstation');
    if (/switch|nintendo/.test(text)) names.add('nintendo');
    if (names.size === 1) ['microsoft','steam','epic','playstation','nintendo'].forEach(name => names.add(name));
    return [...names];
  }

  function rowForCard(card) {
    const rowKey = clean(card?.dataset?.rowKey);
    const button = card?.querySelector('[data-open-game]');
    const title = clean(card?.dataset?.liveTitle || card?.querySelector('.game-card__title')?.textContent);
    if (!rowKey || !title) return null;
    const gameId = clean(card.dataset.liveGameId) || (rowKey.startsWith('online:')
      ? (rowKey.split(':')[1] || '')
      : (rowKey.includes(':') ? rowKey.slice(0, rowKey.indexOf(':')) : rowKey));
    const igdbId = clean(card.dataset.liveIgdbId);
    let platforms = [];
    try {
      const parsed = JSON.parse(card.dataset.livePlatforms || '[]');
      if (Array.isArray(parsed)) platforms = parsed.map(clean).filter(Boolean);
    } catch {}
    if (!platforms.length) {
      platforms = [...card.querySelectorAll('.platform-tag span:last-child')].map(node => clean(node.textContent)).filter(Boolean);
    }
    return { card, rowKey, gameId, igdbId, title, platforms, button };
  }

  function providerSignature(platforms = []) {
    return providersForPlatforms(platforms).slice().sort().join(',');
  }

  function screenKey(game) {
    return `${game.gameId}:${game.title.toLowerCase()}:${providerSignature(game.platforms)}`;
  }

  function screenFresh(game) {
    const entry = screenCache.get(screenKey(game));
    const fetchedAt = Number(entry?.fetchedAt || 0);
    return fetchedAt && Date.now() - fetchedAt < SCREEN_CACHE_TTL_MS;
  }

  async function enrichVisibleGames() {
    screenTimer = 0;
    const cards = [...document.querySelectorAll('#games .game-card[data-live-visible="true"]')]
      .map(rowForCard)
      .filter(Boolean)
      .filter(game => !screenFresh(game) && !screenPending.has(screenKey(game)));
    if (!cards.length) return;

    const groups = new Map();
    for (const game of cards) {
      const providerNames = providersForPlatforms(game.platforms);
      const signature = [...providerNames].sort().join(',');
      if (!groups.has(signature)) groups.set(signature, { providerNames, games: [] });
      groups.get(signature).games.push(game);
    }

    for (const group of groups.values()) {
      for (let offset = 0; offset < group.games.length; offset += 5) {
        const batch = group.games.slice(offset, offset + 5);
        batch.forEach(game => screenPending.add(screenKey(game)));
        try {
          const response = await fetchApi('/enrich', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              games: batch.map(game => ({ id: game.gameId, igdbId: game.igdbId, title: game.title })),
              providers: group.providerNames
            })
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          (payload.results || []).forEach((result, index) => {
            const game = batch[index];
            if (!game) return;
            screenCache.set(screenKey(game), { fetchedAt: Date.now(), payload: { results: [result] } });
            const subscriptions = Object.values(result.providers || {}).reduce(
              (all, provider) => Object.assign(all, provider?.subscriptions || {}),
              { ...(result.merged?.subscriptions || {}) }
            );
            const verifiedAt = new Date().toISOString();
            window.dispatchEvent(new CustomEvent('games:live-enriched', {
              detail: {
                gameId: game.gameId,
                igdbId: String(result.identity?.igdbId || ''),
                title: game.title,
                providers: result.providers || {},
                merged: result.merged || {},
                verifiedAt
              }
            }));
            window.dispatchEvent(new CustomEvent('games:subscription-updated', {
              detail: {
                gameId: game.gameId,
                igdbId: String(result.identity?.igdbId || ''),
                subscriptions,
                checkedProviders: group.providerNames,
                verifiedAt
              }
            }));
          });
        } catch (error) {
          console.warn('Live enrichment viditelných her:', error);
        } finally {
          batch.forEach(game => screenPending.delete(screenKey(game)));
        }
      }
    }
  }

  function scheduleVisibleEnrichment() {
    if (screenTimer) return;
    screenTimer = setTimeout(enrichVisibleGames, 120);
  }

  function observeGameCards() {
    if (!('IntersectionObserver' in window)) return;
    if (!screenObserver) {
      screenObserver = new IntersectionObserver(entries => {
        let changed = false;
        for (const entry of entries) {
          entry.target.dataset.liveVisible = entry.isIntersecting ? 'true' : 'false';
          if (entry.isIntersecting) changed = true;
        }
        if (changed) scheduleVisibleEnrichment();
      }, { rootMargin: '160px 0px', threshold: 0.01 });
    }
    document.querySelectorAll('#games .game-card').forEach(card => {
      if (card.dataset.liveObserved === 'true') return;
      card.dataset.liveObserved = 'true';
      screenObserver.observe(card);
    });
  }

  function ensureStatus() {
    let node = content.querySelector('.live-enrich-status');
    if (node) return node;
    node = document.createElement('div');
    node.className = 'live-enrich-status';
    node.setAttribute('role', 'status');
    const actions = content.querySelector('.detail-actions');
    if (actions) actions.insertAdjacentElement('afterend', node);
    else content.querySelector('.detail-main')?.appendChild(node);
    return node;
  }

  function setStatus(text, state = '') {
    const node = ensureStatus();
    node.textContent = text;
    node.dataset.state = state;
  }

  function addSubscriptions(merged, providers) {
    const subscriptions = { ...(merged?.subscriptions || {}) };
    for (const provider of Object.values(providers || {})) Object.assign(subscriptions, provider?.subscriptions || {});

    const items = [];
    if (subscriptions.gamePassConsole) items.push(['Game Pass Console', 'gamepass']);
    if (subscriptions.gamePassPc) items.push(['PC Game Pass', 'gamepass']);
    if (subscriptions.cloudGaming) items.push(['Xbox Cloud Gaming', 'cloud']);
    if (subscriptions.gamePass && !subscriptions.gamePassConsole && !subscriptions.gamePassPc) items.push(['Game Pass', 'gamepass']);
    if (subscriptions.eaPlay) items.push(['EA Play', 'eaplay']);
    if (subscriptions.psPlus) items.push(['PS Plus', 'psplus']);
    if (subscriptions.geforceNow) items.push(['GeForce NOW', 'gfn']);

    let wrap = content.querySelector('.detail-main > .service-badges');
    if (!items.length) {
      wrap?.remove();
      return subscriptions;
    }

    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'service-badges';
      const summary = content.querySelector('.detail-summary');
      if (summary) summary.insertAdjacentElement('beforebegin', wrap);
      else content.querySelector('.detail-main')?.appendChild(wrap);
    }

    wrap.replaceChildren();
    for (const [label, kind] of items) {
      const badge = document.createElement('span');
      badge.className = `service-badge service-badge--${kind}`;
      badge.innerHTML = `${serviceIcon(kind, { className:'brand-icon--service' })}<span></span>`;
      badge.querySelector('span:last-child').textContent = label;
      wrap.appendChild(badge);
    }
    return subscriptions;
  }

  function youtubeId(value) {
    const raw = clean(value);
    if (/^[A-Za-z0-9_-]{6,20}$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      if (/youtu\.be$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
      if (/youtube\.com$/i.test(url.hostname) || /youtube-nocookie\.com$/i.test(url.hostname)) {
        return url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]+)/)?.[1] || '';
      }
    } catch {}
    return '';
  }

  function addTrailer(merged, providers) {
    if (content.querySelector('.detail-video')) return;
    const igdbVideos = providers?.igdb?.videos || providers?.igdb?.rawHints?.videos || [];
    const yt = igdbVideos.map(item => youtubeId(item?.id || item?.url || item)).find(Boolean)
      || (merged?.videos || []).map(youtubeId).find(Boolean);
    const trailerUrl = (merged?.media?.trailers || []).map(safeUrl).find(url => url && !youtubeId(url));
    if (!yt && !trailerUrl) return;

    let section = content.querySelector('.detail-media-section');
    if (!section) {
      section = document.createElement('section');
      section.className = 'detail-media-section live-media-section';
      const links = content.querySelector('.detail-link-section');
      if (links) links.insertAdjacentElement('beforebegin', section);
      else content.querySelector('.detail-main')?.appendChild(section);
    }

    const label = document.createElement('p');
    label.className = 'detail-section-label';
    label.textContent = 'Trailer';
    const frame = document.createElement('div');
    frame.className = 'detail-video';

    if (yt) {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`;
      iframe.title = 'Trailer';
      iframe.loading = 'lazy';
      iframe.allow = 'encrypted-media; picture-in-picture';
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);
    } else {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = trailerUrl;
      frame.appendChild(video);
    }

    section.prepend(frame);
    section.prepend(label);
  }

  function addScreenshots(merged, title) {
    const urls = (merged?.media?.screenshots || []).map(item => safeUrl(typeof item === 'string' ? item : item?.full || item?.url)).filter(Boolean);
    if (!urls.length) return;

    let section = content.querySelector('.detail-media-section');
    if (!section) {
      section = document.createElement('section');
      section.className = 'detail-media-section live-media-section';
      const links = content.querySelector('.detail-link-section');
      if (links) links.insertAdjacentElement('beforebegin', section);
      else content.querySelector('.detail-main')?.appendChild(section);
    }
    let rail = section.querySelector('.screenshot-rail');
    if (!rail) {
      const label = document.createElement('p');
      label.className = 'detail-section-label detail-section-label--gallery';
      label.textContent = 'Screenshoty';
      rail = document.createElement('div');
      rail.className = 'screenshot-rail';
      section.append(label, rail);
    }
    const existing = new Set([...rail.querySelectorAll('[data-gallery-image]')].map(node => node.dataset.galleryImage));
    for (const url of urls.slice(0, 10)) {
      if (existing.has(url)) continue;
      const button = document.createElement('button');
      button.className = 'gallery-item';
      button.type = 'button';
      button.dataset.galleryImage = url;
      button.setAttribute('aria-label', 'Otevřít screenshot');
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Screenshot ze hry ${title}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      button.appendChild(img);
      rail.appendChild(button);
    }
  }

  function improveSummary(merged) {
    const text = clean(merged?.description || merged?.shortDescription);
    const summary = content.querySelector('.detail-summary');
    if (!summary || text.length < 80) return;
    const current = clean(summary.textContent);
    if (current.length < 110 || /\bje videohra\b/i.test(current)) summary.textContent = text.length > 850 ? `${text.slice(0, 847)}…` : text;
  }

  function historyReleaseLabel(value) {
    const items = Array.isArray(value) ? value : value?.releases;
    if (!Array.isArray(items) || !items.length) return 'bez oznámeného termínu';
    const first = items[0] || {};
    if (first.day) return new Date(`${first.day}T12:00:00Z`).toLocaleDateString('cs-CZ', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
    return first.window || 'bez oznámeného termínu';
  }

  function historyPlatformLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (/playstation 5|\bps5\b/.test(normalized)) return 'PS5';
    if (/playstation 4|\bps4\b/.test(normalized)) return 'PS4';
    if (/xbox series/.test(normalized)) return 'Xbox Series';
    if (/xbox one/.test(normalized)) return 'Xbox One';
    if (/switch 2/.test(normalized)) return 'Switch 2';
    if (/nintendo switch|\bswitch\b/.test(normalized)) return 'Switch';
    if (/windows|\bpc\b/.test(normalized)) return 'PC';
    return String(value || '').trim();
  }

  function historyReleaseItemLabel(item = {}) {
    if (item.day) return new Date(`${item.day}T12:00:00Z`).toLocaleDateString('cs-CZ', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
    return item.window || 'bez oznámeného termínu';
  }

  function historyPlatformReleaseMap(value) {
    const items = Array.isArray(value) ? value : value?.releases;
    const map = new Map();
    if (!Array.isArray(items)) return map;
    for (const item of items) {
      for (const platform of Array.isArray(item?.platforms) ? item.platforms : []) {
        const label = historyPlatformLabel(platform);
        if (!label || map.has(label)) continue;
        map.set(label, historyReleaseItemLabel(item));
      }
    }
    return map;
  }

  function historyReleaseChange(oldValue, newValue) {
    const before = historyPlatformReleaseMap(oldValue);
    const after = historyPlatformReleaseMap(newValue);
    const changed = [];
    for (const [platform, oldLabel] of before) {
      if (!after.has(platform)) continue;
      const newLabel = after.get(platform);
      if (oldLabel !== newLabel) changed.push({ platform, oldLabel, newLabel });
    }
    if (changed.length === 1) {
      const item = changed[0];
      return `${item.platform}: ${item.oldLabel} → ${item.newLabel}`;
    }
    return `${historyReleaseLabel(oldValue)} → ${historyReleaseLabel(newValue)}`;
  }

  function historyPriceSummary(value) {
    const entries = Object.entries(value || {}).filter(([, price]) => price && (price.currentText || price.current != null));
    if (!entries.length) return 'bez ceny';
    return entries.map(([provider, price]) => {
      const label = provider === 'microsoft' ? 'Xbox' : provider === 'playstation' ? 'PlayStation' : provider === 'nintendo' ? 'Nintendo' : provider === 'steam' ? 'Steam' : provider === 'epic' ? 'Epic' : provider;
      const text = clean(price.currentText);
      if (text) return `${label}: ${text}`;
      const current = Number(price.current);
      const currency = clean(price.currency).toUpperCase();
      return Number.isFinite(current) ? `${label}: ${current}${currency ? ` ${currency}` : ''}` : label;
    }).join(' · ');
  }

  function historySubscriptionSummary(value) {
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

  function historyPriceTrend(oldValue, newValue) {
    const before = oldValue || {};
    const after = newValue || {};
    let lower = false;
    let higher = false;
    for (const provider of Object.keys(after)) {
      const oldPrice = Number(before?.[provider]?.current);
      const newPrice = Number(after?.[provider]?.current);
      if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice) || oldPrice === newPrice) continue;
      if (newPrice < oldPrice) lower = true;
      if (newPrice > oldPrice) higher = true;
    }
    if (lower && !higher) return 'Zlevněno';
    if (higher && !lower) return 'Zdraženo';
    return 'Změna ceny';
  }

  function historySubscriptionChange(oldValue, newValue) {
    const before = oldValue || {};
    const after = newValue || {};
    const services = [
      ['gamePassConsole', 'Game Pass Console'],
      ['gamePassPc', 'PC Game Pass'],
      ['cloudGaming', 'Xbox Cloud Gaming'],
      ['eaPlay', 'EA Play'],
      ['psPlus', 'PS Plus'],
      ['geforceNow', 'GeForce NOW']
    ];
    const added = [];
    const removed = [];
    for (const [key, label] of services) {
      if (!before[key] && after[key]) added.push(label);
      if (before[key] && !after[key]) removed.push(label);
    }

    const beforeSpecific = before.gamePassConsole || before.gamePassPc || before.cloudGaming;
    const afterSpecific = after.gamePassConsole || after.gamePassPc || after.cloudGaming;
    if (!beforeSpecific && !afterSpecific) {
      if (!before.gamePass && after.gamePass) added.push('Game Pass');
      if (before.gamePass && !after.gamePass) removed.push('Game Pass');
    }

    const parts = [];
    if (added.length) parts.push(`Přidáno: ${added.join(', ')}`);
    if (removed.length) parts.push(`Odebráno: ${removed.join(', ')}`);
    return parts.join(' · ');
  }

  function historyText(item) {
    if (item.field === 'releaseDates') {
      const before = historyReleaseLabel(item.oldValue);
      const after = historyReleaseLabel(item.newValue);
      if (before === after && historyPlatformReleaseMap(item.oldValue).size === historyPlatformReleaseMap(item.newValue).size) return '';
      return `Změna termínu · ${historyReleaseChange(item.oldValue, item.newValue)}`;
    }
    if (item.field === 'prices') {
      const before = historyPriceSummary(item.oldValue);
      const after = historyPriceSummary(item.newValue);
      if (before === after) return '';
      return `${historyPriceTrend(item.oldValue, item.newValue)} · ${before} → ${after}`;
    }
    if (item.field === 'subscriptions') {
      const change = historySubscriptionChange(item.oldValue, item.newValue);
      const before = historySubscriptionSummary(item.oldValue);
      const after = historySubscriptionSummary(item.newValue);
      if (!change && before === after) return '';
      return change || `Předplatné · ${before} → ${after}`;
    }
    if (item.field === 'earlyAccess') {
      if (item.oldValue === item.newValue) return '';
      if (item.oldValue === true && item.newValue === false) return 'Early Access byl ukončen';
      if (item.oldValue === false && item.newValue === true) return 'Hra vstoupila do Early Access';
      return 'Změna Early Access stavu';
    }
    if (item.field === 'gameAdded') return 'Hra přidána do katalogu';
    if (item.field === 'gameRemoved') return 'Hra odebrána z katalogu';
    return '';
  }

  async function addHistory(gameKey) {
    const key = clean(gameKey);
    if (!key || content.querySelector('.detail-history-section')) return;
    try {
      const response = await fetchApi(`/history/${encodeURIComponent(key)}?limit=12`, { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      const items = (data.items || []).map(item => ({ ...item, text: historyText(item) })).filter(item => item.text);
      if (!items.length) return;

      const section = document.createElement('section');
      section.className = 'detail-link-section detail-history-section';
      section.setAttribute('aria-label', 'Historie změn hry');

      const disclosure = document.createElement('details');
      disclosure.className = 'detail-history-disclosure';

      const summary = document.createElement('summary');
      summary.className = 'detail-history-summary';

      const label = document.createElement('span');
      label.className = 'detail-history-summary__label';
      label.textContent = 'Historie změn';

      const count = document.createElement('span');
      count.className = 'detail-history-summary__count';
      count.textContent = String(Math.min(items.length, 8));
      count.setAttribute('aria-label', `${Math.min(items.length, 8)} záznamů`);

      summary.append(label, count);

      const list = document.createElement('div');
      list.className = 'detail-history-list';

      for (const item of items.slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'detail-history-item';
        const strong = document.createElement('strong');
        strong.textContent = item.text;
        const time = document.createElement('time');
        const date = new Date(item.changedAt);
        time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
        row.append(strong, time);
        list.appendChild(row);
      }

      disclosure.append(summary, list);
      section.append(disclosure);
      const main = content.querySelector('.detail-main');
      if (main) main.appendChild(section);
    } catch {}
  }

  function formattedPrice(provider) {
    const price = provider?.price;
    if (!price) return '';
    const value = Number(price.current);
    if (price.isFree === true) return 'Zdarma';
    if (!clean(price.currentText) && (!Number.isFinite(value) || value <= 0)) return '';

    const text = clean(price.currentText);
    let current = text;
    if (!current) {
      const currency = clean(price.currency).toUpperCase();
      if (Number.isFinite(value) && value > 0 && currency) {
        try {
          current = new Intl.NumberFormat('cs-CZ', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'CZK' ? 0 : 2
          }).format(value);
        } catch {
          current = `${value} ${currency}`;
        }
      }
    }
    if (!current) return '';

    let discount = Number(price.discountPercent || 0);
    const regular = Number(price.regular);
    if (!discount && Number.isFinite(regular) && regular > 0 && Number.isFinite(value) && value > 0 && value < regular) {
      discount = Math.round((1 - value / regular) * 100);
    }
    const prefix = price.from ? 'od ' : '';
    const priced = `${prefix}${current}`;
    const base = discount > 0 ? `${priced} · −${Math.round(discount)} %` : priced;
    return provider?.lastKnownPrice || provider?.rawHints?.lastKnownPrice
      ? `${base} · posl. známá`
      : base;
  }

  function ensureStoreGrid() {
    let grid = content.querySelector('.detail-store-grid');
    if (grid) return grid;
    const section = document.createElement('section');
    section.className = 'detail-link-section detail-link-section--stores';
    section.setAttribute('aria-label', 'Obchody pro toto vydání');
    const heading = document.createElement('p');
    heading.className = 'detail-section-label';
    heading.textContent = 'Kde hru najít';
    grid = document.createElement('div');
    grid.className = 'detail-store-grid';
    section.append(heading, grid);
    const more = content.querySelector('.detail-link-section:not(.detail-link-section--stores)');
    if (more) more.insertAdjacentElement('beforebegin', section);
    else content.querySelector('.detail-main')?.appendChild(section);
    return grid;
  }

  function ensureStoreLink(kind, label) {
    let link = content.querySelector(`.store-link--${kind}`);
    if (link) return link;
    const grid = ensureStoreGrid();
    link = document.createElement('a');
    link.className = `store-link store-link--${kind}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const icon = document.createElement('span');
    icon.className = 'store-link__icon';
    icon.innerHTML = storeIcon(kind);
    const text = document.createElement('span');
    text.className = 'store-link__label';
    text.textContent = label;
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('class', 'store-link__arrow');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<path d="M8 16 16 8m-6 0h6v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    link.append(icon, text, arrow);
    grid.appendChild(link);
    return link;
  }

  function isFallbackStoreLink(link, kind) {
    const href = safeUrl(link?.href);
    if (!href) return false;
    try {
      const url = new URL(href);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();
      if (kind === 'steam') return host === 'store.steampowered.com' && path.startsWith('/search');
      if (kind === 'epic') return host === 'store.epicgames.com' && path.includes('/browse');
      if (kind === 'xbox') return host.endsWith('xbox.com') && path.toLowerCase().includes('/search/results');
      if (kind === 'playstation') return host === 'store.playstation.com' && path.includes('/search/');
      if (kind === 'nintendo') return host.endsWith('nintendo.com') && path.includes('/search/');
    } catch {}
    return false;
  }

  function applyStoreAvailability(providerStatus = {}) {
    const providerByKind = {
      steam: 'steam',
      epic: 'epic',
      xbox: 'microsoft',
      playstation: 'playstation',
      nintendo: 'nintendo'
    };
    for (const [kind, provider] of Object.entries(providerByKind)) {
      if (providerStatus?.[provider]?.status !== 'not_found') continue;
      content.querySelectorAll(`.store-link--${kind}`).forEach(link => {
        if (isFallbackStoreLink(link, kind)) link.remove();
      });
    }
    const grid = content.querySelector('.detail-store-grid');
    if (grid && !grid.children.length) grid.closest('.detail-link-section--stores')?.remove();
  }

  function improveStoreLinks(providers) {
    const stores = {
      steam: { provider: providers?.steam, label: 'Steam' },
      epic: { provider: providers?.epic, label: 'Epic Games' },
      xbox: { provider: providers?.microsoft, label: 'Microsoft / Xbox Store' },
      playstation: { provider: providers?.playstation, label: 'PlayStation Store' },
      nintendo: { provider: providers?.nintendo, label: 'Nintendo Store' }
    };
    for (const [kind, store] of Object.entries(stores)) {
      const url = safeUrl(store.provider?.storeUrl);
      if (!url) continue;
      const firstLink = ensureStoreLink(kind, store.label);
      const links = kind === 'xbox'
        ? [...content.querySelectorAll('.store-link--xbox')]
        : [firstLink];
      const price = formattedPrice(store.provider);

      for (const link of links) {
        link.href = url;
        link.dataset.exactStoreLink = 'true';
        const label = link.querySelector('.store-link__label');
        if (!label) continue;

        if (!link.dataset.liveBaseLabel) {
          const current = clean(label.textContent);
          link.dataset.liveBaseLabel = current.split(' · ')[0] || store.label;
        }
        const parts = [link.dataset.liveBaseLabel || store.label];
        if (price) parts.push(price);
        if (kind === 'xbox' && store.provider?.subscriptions?.gamePass) parts.push('Game Pass');
        label.textContent = parts.join(' · ');
      }
    }
  }

  function formatLiveReleaseDate(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return '';
    const date = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }

  function applySteamReleaseDate(result) {
    const steam = result?.providers?.steam;
    const day = clean(steam?.releaseDate);
    const matched = Array.isArray(result?.matchedProviders) && result.matchedProviders.includes('steam');
    const pcRelease = platformTexts().some(value => /\bpc\b|windows/i.test(value));
    const formatted = formatLiveReleaseDate(day);
    if (!matched || !pcRelease || !formatted) return;

    const dateBadge = [...content.querySelectorAll('.detail-meta .badge')]
      .find(node => clean(node.textContent).startsWith('📅'));
    if (dateBadge) dateBadge.textContent = `📅 ${formatted}`;

    window.dispatchEvent(new CustomEvent('games:live-release-date', {
      detail: {
        gameId: currentGameId(),
        igdbId: currentIgdbId(),
        provider: 'steam',
        day
      }
    }));
  }

  function fieldSourceSummary(merged) {
    const fields = merged?.fieldSources || {};
    const parts = [];
    const label = source => PROVIDER_LABELS[source] || source || '';
    if (fields.description) parts.push(`Popis: ${label(fields.description)}`);
    if (fields.cover) parts.push(`Obal: ${label(fields.cover)}`);
    if (fields.metadata) parts.push(`Metadata: ${label(fields.metadata)}`);
    return parts.join(' · ');
  }

  function applyLiveData(title, payload) {
    const result = payload?.results?.[0];
    if (!result) throw new Error('API nevrátilo detail hry');
    const providers = result.providers || {};
    const merged = result.merged || {};
    const checkedProviders = Array.isArray(result.matchedProviders) ? result.matchedProviders : Object.keys(providers);
    const currentSubscriptions = {};
    for (const provider of Object.values(providers || {})) Object.assign(currentSubscriptions, provider?.subscriptions || {});
    const verifiedAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent('games:live-enriched', {
      detail: {
        gameId: currentGameId(),
        igdbId: String(result.identity?.igdbId || currentIgdbId() || ''),
        title,
        providers,
        merged,
        verifiedAt
      }
    }));
    addSubscriptions(merged, providers);
    applyStoreAvailability(result.providerStatus || {});
    window.dispatchEvent(new CustomEvent('games:subscription-updated', {
      detail: {
        gameId: currentGameId(),
        igdbId: String(result.identity?.igdbId || currentIgdbId() || ''),
        subscriptions: currentSubscriptions,
        checkedProviders,
        verifiedAt
      }
    }));
    improveStoreLinks(providers);
    applySteamReleaseDate(result);
    addTrailer(merged, providers);
    addHistory(result.gameKey || result.query?.id || '');
    addScreenshots(merged, title);
    improveSummary(merged);

    const matched = checkedProviders.map(name => PROVIDER_LABELS[name] || name);
    const remembered = (result.lastKnownProviders || []).filter(name => !checkedProviders.includes(name)).map(name => PROVIDER_LABELS[name] || name);
    const identity = result.identity?.igdbId ? ` · IGDB #${result.identity.igdbId}` : '';
    const fieldSources = fieldSourceSummary(merged);
    setStatus(matched.length
      ? `Živě ověřeno: ${matched.join(' · ')}${remembered.length ? ` · poslední známé: ${remembered.join(' · ')}` : ''}${identity}${fieldSources ? ` · ${fieldSources}` : ''}`
      : remembered.length
        ? `Použita poslední známá data: ${remembered.join(' · ')}`
        : 'Živé zdroje pro tuto hru nenašly jistou shodu.', matched.length ? 'ok' : remembered.length ? 'ok' : 'empty');
  }

  async function enrichCurrent() {
    if (!dialog.open) return;
    const title = currentTitle();
    if (!title || pendingTitle === title || content.dataset.liveEnrichedTitle === title) return;
    pendingTitle = title;
    content.dataset.liveEnrichedTitle = title;
    setStatus('Ověřuji ceny, předplatné, odkazy a média…', 'loading');

    try {
      const cacheKey = currentEnrichmentKey();
      let payload = cachedPayload(cacheKey);
      if (!payload) {
        const screenEntry = screenCache.get(screenKey({
          gameId: currentGameId(),
          title,
          platforms: platformTexts()
        }));
        if (screenEntry?.payload && Date.now() - Number(screenEntry.fetchedAt || 0) < SCREEN_CACHE_TTL_MS) {
          payload = screenEntry.payload;
          cachePayload(cacheKey, payload);
        }
      }
      if (!payload) {
        const providers = providersForPlatforms(platformTexts());
        const response = await fetchApi('/enrich', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            game: { id: currentGameId(), igdbId: currentIgdbId(), title },
            providers
          })
        });
        payload = await response.json();
        cachePayload(cacheKey, payload);
      }
      if (currentTitle() !== title || !dialog.open) return;
      applyLiveData(title, payload);
    } catch (error) {
      if (currentTitle() === title) setStatus(`Živé ověření se nepodařilo: ${error?.message || error}`, 'error');
    } finally {
      if (pendingTitle === title) pendingTitle = '';
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(enrichCurrent, 80);
  }

  new MutationObserver(schedule).observe(content, { childList: true, subtree: false });
  const gamesGrid = document.getElementById('games');
  if (gamesGrid) {
    new MutationObserver(() => {
      if (screenObserver) screenObserver.disconnect();
      observeGameCards();
      scheduleVisibleEnrichment();
    }).observe(gamesGrid, { childList: true });
    observeGameCards();
  }
  new MutationObserver(schedule).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  dialog.addEventListener('close', () => {
    pendingTitle = '';
    content.removeAttribute('data-live-enriched-title');
  });

  schedule();
})();
