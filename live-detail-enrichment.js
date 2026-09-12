(() => {
  const dialog = document.getElementById('game-dialog');
  const content = document.getElementById('dialog-content');
  if (!dialog || !content || window.__gamesLiveDetailEnrichment) return;
  window.__gamesLiveDetailEnrichment = true;

  // The Oracle deployment exposes the API next to the static site. GitHub Pages
  // keeps working without live enrichment and continues to use games.json.
  const API_ROOT = location.pathname.startsWith('/games/') ? '/games-api' : '';
  if (!API_ROOT) return;

  const cache = new Map();
  let pendingTitle = '';
  let timer = 0;

  const PROVIDER_LABELS = {
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
    const names = new Set();
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
    if (!names.size) ['microsoft','steam','playstation','nintendo'].forEach(name => names.add(name));
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

  function formatPrice(price) {
    if (!price) return '';
    if (clean(price.currentText)) return clean(price.currentText);
    const value = Number(price.current);
    if (!Number.isFinite(value)) return '';
    if (value === 0) return 'Zdarma';
    const currency = String(price.currency || 'CZK').toUpperCase();
    try {
      return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(value)} ${currency}`;
    }
  }

  function regularPrice(price, currentText) {
    if (!price) return '';
    if (clean(price.regularText) && clean(price.regularText) !== currentText) return clean(price.regularText);
    const regular = Number(price.regular);
    const current = Number(price.current);
    if (!Number.isFinite(regular) || regular <= 0 || regular === current) return '';
    const currency = String(price.currency || 'CZK').toUpperCase();
    try {
      return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 2 }).format(regular);
    } catch { return `${regular} ${currency}`; }
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

  function addPrices(providers) {
    const priced = Object.entries(providers || {})
      .filter(([, item]) => item?.price && formatPrice(item.price))
      .map(([name, item]) => ({ name, item, current: formatPrice(item.price) }));
    if (!priced.length) return;

    content.querySelector('.live-price-section')?.remove();
    const section = document.createElement('section');
    section.className = 'detail-subsection live-price-section';
    const heading = document.createElement('p');
    heading.className = 'detail-section-label';
    heading.textContent = 'Ceny podle obchodu / platformy';
    const grid = document.createElement('div');
    grid.className = 'live-price-grid';

    for (const { name, item, current } of priced) {
      const url = safeUrl(item.storeUrl);
      const row = document.createElement(url ? 'a' : 'div');
      row.className = 'live-price-card';
      if (url) {
        row.href = url;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
      }
      const label = document.createElement('span');
      label.className = 'live-price-card__store';
      label.textContent = PROVIDER_LABELS[name] || name;
      const value = document.createElement('strong');
      value.className = 'live-price-card__price';
      value.textContent = current;
      const regular = regularPrice(item.price, current);
      if (regular) {
        const old = document.createElement('del');
        old.textContent = regular;
        value.append(' ', old);
      }
      row.append(label, value);
      grid.appendChild(row);
    }

    section.append(heading, grid);
    const links = content.querySelector('.detail-link-section--stores, .detail-link-section');
    if (links) links.insertAdjacentElement('beforebegin', section);
    else content.querySelector('.detail-main')?.appendChild(section);
  }

  function addTrailer(merged) {
    if (content.querySelector('.detail-video')) return;
    const trailerUrl = (merged?.media?.trailers || []).map(safeUrl).find(Boolean);
    if (!trailerUrl) return;

    let section = content.querySelector('.detail-media-section');
    if (!section) {
      section = document.createElement('section');
      section.className = 'detail-media-section live-media-section';
      const links = content.querySelector('.live-price-section, .detail-link-section');
      if (links) links.insertAdjacentElement('beforebegin', section);
      else content.querySelector('.detail-main')?.appendChild(section);
    }

    const label = document.createElement('p');
    label.className = 'detail-section-label';
    label.textContent = 'Trailer';
    const frame = document.createElement('div');
    frame.className = 'detail-video';
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = trailerUrl;
    frame.appendChild(video);
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
      const links = content.querySelector('.live-price-section, .detail-link-section');
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
    // Replace only generated/very short descriptions; preserve richer curated text.
    if (current.length < 110 || /\bje videohra\b/i.test(current)) summary.textContent = text.length > 850 ? `${text.slice(0, 847)}…` : text;
  }

  function applyLiveData(title, payload) {
    const result = payload?.results?.[0];
    if (!result) throw new Error('API nevrátilo detail hry');
    const providers = result.providers || {};
    const merged = result.merged || {};
    addSubscriptions(merged, providers);
    addPrices(providers);
    addTrailer(merged);
    addScreenshots(merged, title);
    improveSummary(merged);

    const matched = Object.keys(providers).map(name => PROVIDER_LABELS[name] || name);
    setStatus(matched.length
      ? `Živě ověřeno: ${matched.join(' · ')}`
      : 'Živé zdroje pro tuto hru nenašly jistou shodu.', matched.length ? 'ok' : 'empty');
  }

  async function enrichCurrent() {
    if (!dialog.open) return;
    const title = currentTitle();
    if (!title || pendingTitle === title || content.dataset.liveEnrichedTitle === title) return;
    pendingTitle = title;
    content.dataset.liveEnrichedTitle = title;
    setStatus('Ověřuji ceny, předplatné a média v oficiálních obchodech…', 'loading');

    try {
      let payload = cache.get(title);
      if (!payload) {
        const providers = providersForPlatforms(platformTexts());
        const response = await fetch(`${API_ROOT}/enrich`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ game: { title }, providers })
        });
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
