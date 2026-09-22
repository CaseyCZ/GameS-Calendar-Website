(() => {
  const dialog = document.getElementById('game-dialog');
  const content = document.getElementById('dialog-content');
  if (!dialog || !content || window.__gamesLiveDetailEnrichment) return;
  window.__gamesLiveDetailEnrichment = true;

  const API_ROOT = location.pathname.startsWith('/games/') ? '/games-api' : '';
  if (!API_ROOT) return;

  const cache = new Map();
  let pendingTitle = '';
  let timer = 0;

  const PROVIDER_LABELS = {
    igdb: 'IGDB',
    steam: 'Steam · PC',
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

  function platformTexts() {
    return [...content.querySelectorAll('.detail-meta .badge')]
      .map(node => clean(node.textContent))
      .filter(text => text && !text.includes('📅') && !text.includes('★'));
  }

  function providersForPlatforms(platforms) {
    const text = platforms.join(' ').toLowerCase();
    const names = new Set(['igdb']);
    if (/\bpc\b|windows/.test(text)) {
      names.add('steam');
      names.add('microsoft');
      names.add('geforceNow');
    }
    if (/xbox/.test(text)) {
      names.add('microsoft');
      names.add('geforceNow');
    }
    if (/ps4|ps5|playstation/.test(text)) names.add('playstation');
    if (/switch|nintendo/.test(text)) names.add('nintendo');
    if (names.size === 1) ['microsoft','steam','playstation','nintendo'].forEach(name => names.add(name));
    return [...names];
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
    if (!items.length) return;

    let wrap = content.querySelector('.detail-main > .service-badges');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'service-badges';
      const summary = content.querySelector('.detail-summary');
      if (summary) summary.insertAdjacentElement('beforebegin', wrap);
      else content.querySelector('.detail-main')?.appendChild(wrap);
    }

    for (const [label, kind] of items) {
      if ([...wrap.querySelectorAll('.service-badge')].some(node => clean(node.textContent) === label)) continue;
      const badge = document.createElement('span');
      badge.className = `service-badge service-badge--${kind}`;
      badge.textContent = label;
      wrap.appendChild(badge);
    }
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

  function historyText(item) {
    if (item.field === 'releaseDates') return 'Změna termínu vydání';
    if (item.field === 'prices') return 'Změna ceny';
    if (item.field === 'subscriptions') return 'Změna předplatného';
    if (item.field === 'earlyAccess') {
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
    if (!key || !API_ROOT || content.querySelector('.detail-history-section')) return;
    try {
      const response = await fetch(`${API_ROOT}/history/${encodeURIComponent(key)}?limit=12`, { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      const items = (data.items || []).map(item => ({ ...item, text: historyText(item) })).filter(item => item.text);
      if (!items.length) return;

      const section = document.createElement('section');
      section.className = 'detail-link-section detail-history-section';
      section.setAttribute('aria-label', 'Historie změn hry');

      const label = document.createElement('p');
      label.className = 'detail-section-label';
      label.textContent = 'Historie změn';

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

      section.append(label, list);
      const main = content.querySelector('.detail-main');
      if (main) main.appendChild(section);
    } catch {}
  }

  function formattedPrice(provider) {
    const price = provider?.price;
    if (!price) return '';
    const text = clean(price.currentText);
    let current = text;
    if (!current) {
      const value = Number(price.current);
      const currency = clean(price.currency).toUpperCase();
      if (Number.isFinite(value) && currency) {
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
    const value = Number(price.current);
    if (!discount && Number.isFinite(regular) && regular > 0 && Number.isFinite(value) && value < regular) {
      discount = Math.round((1 - value / regular) * 100);
    }
    return discount > 0 ? `${current} · −${Math.round(discount)} %` : current;
  }

  function improveStoreLinks(providers) {
    const stores = {
      steam: { provider: providers?.steam, label: 'Steam' },
      xbox: { provider: providers?.microsoft, label: 'Xbox Store' },
      playstation: { provider: providers?.playstation, label: 'PlayStation Store' },
      nintendo: { provider: providers?.nintendo, label: 'Nintendo Store' }
    };
    for (const [kind, store] of Object.entries(stores)) {
      const url = safeUrl(store.provider?.storeUrl);
      if (!url) continue;
      const link = content.querySelector(`.store-link--${kind}`);
      if (!link) continue;
      link.href = url;
      link.dataset.exactStoreLink = 'true';
      const price = formattedPrice(store.provider);
      const label = link.querySelector('.store-link__label');
      if (label) label.textContent = price ? `${store.label} · ${price}` : store.label;
    }
  }

  function applyLiveData(title, payload) {
    const result = payload?.results?.[0];
    if (!result) throw new Error('API nevrátilo detail hry');
    const providers = result.providers || {};
    const merged = result.merged || {};
    addSubscriptions(merged, providers);
    improveStoreLinks(providers);
    addTrailer(merged, providers);
    addHistory(result.gameKey || result.query?.id || '');
    addScreenshots(merged, title);
    improveSummary(merged);

    const matched = Object.keys(providers).map(name => PROVIDER_LABELS[name] || name);
    const identity = result.identity?.igdbId ? ` · IGDB #${result.identity.igdbId}` : '';
    setStatus(matched.length
      ? `Živě ověřeno: ${matched.join(' · ')}${identity}`
      : 'Živé zdroje pro tuto hru nenašly jistou shodu.', matched.length ? 'ok' : 'empty');
  }

  async function enrichCurrent() {
    if (!dialog.open) return;
    const title = currentTitle();
    if (!title || pendingTitle === title || content.dataset.liveEnrichedTitle === title) return;
    pendingTitle = title;
    content.dataset.liveEnrichedTitle = title;
    setStatus('Ověřuji IGDB identitu, předplatné a média…', 'loading');

    try {
      let payload = cache.get(title);
      if (!payload) {
        const providers = providersForPlatforms(platformTexts());
        let response;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await fetch(`${API_ROOT}/enrich`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ game: { title }, providers })
          });
          if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
        if (!response.ok) throw new Error(`API ${response.status}`);
        payload = await response.json();
        cache.set(title, payload);
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
  new MutationObserver(schedule).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  dialog.addEventListener('close', () => {
    pendingTitle = '';
    content.removeAttribute('data-live-enriched-title');
  });

  schedule();
})();
