(() => {
  const PREF_KEY = 'games-calendar-card-badge-visibility-v2';
  const LEGACY_KEY = 'games-calendar-badge-prefs-v1';

  const GROUPS = [
    {
      label: 'Základní',
      items: [
        ['release', 'Termín / odpočet'],
        ['rating', 'Hodnocení']
      ]
    },
    {
      label: 'Kategorie',
      items: [
        ['aaa', 'AAA'],
        ['indie', 'Indie'],
        ['small', 'Menší titul'],
        ['early', 'Early Access']
      ]
    },
    {
      label: 'Typ hry',
      items: [
        ['full', 'Plná hra'],
        ['dlc', 'DLC'],
        ['expansion', 'Rozšíření'],
        ['remake', 'Remake'],
        ['remaster', 'Remaster'],
        ['demo', 'Demo'],
        ['mod', 'Mod']
      ]
    },
    {
      label: 'Předplatné',
      items: [
        ['gamepass', 'Game Pass'],
        ['psplus', 'PS Plus'],
        ['gfn', 'GeForce NOW']
      ]
    }
  ];

  const DEFAULTS = Object.fromEntries(GROUPS.flatMap(group => group.items).map(([key]) => [key, key !== 'full']));
  let prefs = readPrefs();

  function readPrefs() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  }

  function ensureDetailGestureFix() {
    if (!document.querySelector('link[data-detail-gesture-fix]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'detail-gesture-fix.css';
      link.dataset.detailGestureFix = '1';
      document.head.appendChild(link);
    }
    import('./detail-gesture-fix.js').catch(error => console.warn('Detail gesture fix:', error));
  }

  function normalize(value = '') {
    return String(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function scaleKey(text) {
    const value = normalize(text);
    if (value === 'aaa' || value.includes('triple a')) return 'aaa';
    if (value.includes('indie')) return 'indie';
    if (value.includes('mensi') || value.includes('small')) return 'small';
    return '';
  }

  function contentTypeKey(text) {
    const value = normalize(text);
    if (value.includes('plna hra') || value === 'full game') return 'full';
    if (value === 'dlc' || value.includes('downloadable')) return 'dlc';
    if (value.includes('rozsireni') || value.includes('expansion')) return 'expansion';
    if (value.includes('remake')) return 'remake';
    if (value.includes('remaster')) return 'remaster';
    if (value.includes('demo')) return 'demo';
    if (value === 'mod' || value.includes('modifikace')) return 'mod';
    return '';
  }

  function enableLegacyBadgeEngine() {
    const legacy = {
      release: true,
      scale: true,
      type: true,
      fullType: true,
      early: true,
      services: true,
      rating: true
    };
    try { localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy)); } catch {}

    document.querySelectorAll('[data-badge-pref]').forEach(input => {
      if (!input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function removeBadgeControlsFromSettings() {
    const group = document.querySelector('[data-advanced-settings]');
    if (!group) return;
    group.querySelector('.advanced-setting-list')?.remove();
    [...group.querySelectorAll('.settings-group__label')].forEach(label => {
      if (label.textContent.trim() === 'Odznaky na kartách') label.remove();
      if (label.textContent.trim() === 'Detail hry') label.classList.remove('settings-group__label--spaced');
    });
  }

  function ensureFilterControls() {
    const host = document.querySelector('.trait-filter-section') || document.querySelector('.genre-filter-wrap');
    if (!host || host.querySelector('.badge-visibility-section')) return;

    const details = document.createElement('details');
    details.className = 'badge-visibility-section';
    details.innerHTML = `
      <summary class="badge-visibility-summary">
        <span>Odznaky na kartách</span>
        <small>každý zvlášť</small>
      </summary>
      <div class="badge-visibility-body">
        ${GROUPS.map(group => `
          <div class="badge-visibility-group">
            <span class="badge-visibility-label">${group.label}</span>
            <div class="badge-visibility-list">
              ${group.items.map(([key, label]) => `
                <label class="advanced-setting badge-visibility-setting">
                  <span>${label}</span>
                  <input type="checkbox" data-card-badge-pref="${key}" ${prefs[key] ? 'checked' : ''}>
                  <i aria-hidden="true"></i>
                </label>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;

    details.addEventListener('change', event => {
      const input = event.target.closest('[data-card-badge-pref]');
      if (!input) return;
      prefs[input.dataset.cardBadgePref] = input.checked;
      savePrefs();
      applyPrefs();
    });

    host.appendChild(details);
  }

  function decorateCards() {
    document.querySelectorAll('#games .game-card').forEach(card => {
      card.querySelectorAll('.badge--scale').forEach(badge => {
        badge.classList.remove('badge--scale-aaa', 'badge--scale-indie', 'badge--scale-small');
        const key = scaleKey(badge.textContent);
        if (key) badge.classList.add(`badge--scale-${key}`);
      });

      card.querySelectorAll('.badge--content-type').forEach(badge => {
        const key = contentTypeKey(badge.textContent);
        badge.dataset.cardBadgeType = key;
      });
    });
  }

  function syncControls() {
    document.querySelectorAll('[data-card-badge-pref]').forEach(input => {
      input.checked = prefs[input.dataset.cardBadgePref] !== false;
    });
  }

  function applyPrefs() {
    decorateCards();
    const root = document.documentElement;
    Object.keys(DEFAULTS).forEach(key => root.classList.toggle(`hide-card-badge-${key}`, prefs[key] === false));
    syncControls();
  }

  function observeCards() {
    const games = document.getElementById('games');
    if (!games) return;
    const observer = new MutationObserver(() => requestAnimationFrame(applyPrefs));
    observer.observe(games, { childList: true, subtree: true });
  }

  function observeUi() {
    const observer = new MutationObserver(() => {
      enableLegacyBadgeEngine();
      removeBadgeControlsFromSettings();
      ensureFilterControls();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setup() {
    ensureDetailGestureFix();
    enableLegacyBadgeEngine();
    removeBadgeControlsFromSettings();
    ensureFilterControls();
    applyPrefs();
    observeCards();
    observeUi();
  }

  setup();
})();
