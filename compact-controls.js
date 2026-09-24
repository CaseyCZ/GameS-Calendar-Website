(() => {
  const $ = id => document.getElementById(id);

  function iconSliders() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6"/></svg>';
  }

  function iconSort() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 6h11M8 12h8M8 18h5M4 4v16m0 0-2.5-2.5M4 20l2.5-2.5"/></svg>';
  }

  function iconSettings() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.37a1.7 1.7 0 0 0-1 .63 1.7 1.7 0 0 0-.37 1.08V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.23 15a1.7 1.7 0 0 0-.63-1 1.7 1.7 0 0 0-1.08-.37H2.5v-4h.08A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.57 4.2a1.7 1.7 0 0 0 1-.63A1.7 1.7 0 0 0 9.94 2.5V2h4v.08A1.7 1.7 0 0 0 15 3.7a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 8a1.7 1.7 0 0 0 .63 1 1.7 1.7 0 0 0 1.08.37H21.5v4h-.08A1.7 1.7 0 0 0 19.8 14a1.7 1.7 0 0 0-.4 1Z"/></svg>';
  }

  function iconInfo() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10.5v6M12 7.3h.01"/></svg>';
  }

  function iconSun() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  }

  function iconMoon() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.2A8 8 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2Z"/></svg>';
  }

  function activeFilterCount() {
    const genreCount = document.querySelectorAll('.genre-filter-chip.is-active').length;
    const status = $('status-filter');
    const precision = $('precision-filter');
    const activePeriod = document.querySelector('[data-period].is-active');
    const contextCount = document.querySelectorAll('#active-context-filters .context-filter').length;
    let count = genreCount + contextCount;
    if (status && status.value !== 'upcoming') count += 1;
    if (precision && precision.value !== 'all') count += 1;
    if (activePeriod && activePeriod.dataset.period !== 'month') count += 1;
    return count;
  }

  function updateFilterBadge() {
    const badge = $('filter-summary-count');
    const summary = document.querySelector('.filters-disclosure > .filter-summary');
    if (!badge || !summary) return;
    const count = activeFilterCount();
    const countText = count ? String(count) : '';
    if (badge.dataset.count !== String(count)) badge.dataset.count = String(count);
    if (badge.textContent !== countText) badge.textContent = countText;
    if (summary.classList.contains('has-active') !== (count > 0)) summary.classList.toggle('has-active', count > 0);
  }

  function setupSortMenu(select, quick) {
    const details = document.createElement('details');
    details.className = 'sort-disclosure';
    details.id = 'sort-disclosure';
    details.innerHTML = `
      <summary class="filter-summary sort-summary" aria-label="Otevřít řazení">
        ${iconSort()}
        <span class="filter-summary__label">Seřadit</span>
      </summary>
      <div class="sort-panel" role="group" aria-label="Seřadit hry">
        <p class="sort-panel__title">Seřadit</p>
        <div class="sort-options">
          <button type="button" class="sort-option" data-sort-value="name-asc"><span>Název</span><strong>A–Z</strong></button>
          <button type="button" class="sort-option" data-sort-value="name-desc"><span>Název</span><strong>Z–A</strong></button>
          <button type="button" class="sort-option" data-sort-value="date-desc"><span>Termín vydání</span><strong>Nejnovější</strong></button>
          <button type="button" class="sort-option" data-sort-value="date-asc"><span>Termín vydání</span><strong>Nejbližší</strong></button>
          <button type="button" class="sort-option" data-sort-value="rating-desc"><span>Hodnocení</span><strong>Nejvyšší</strong></button>
          <button type="button" class="sort-option" data-sort-value="rating-asc"><span>Hodnocení</span><strong>Nejnižší</strong></button>
        </div>
      </div>`;

    select.classList.add('sort-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    details.querySelector('.sort-panel').appendChild(select);

    const sync = () => {
      details.querySelectorAll('[data-sort-value]').forEach(button => {
        const active = button.dataset.sortValue === select.value;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      details.classList.toggle('has-active', select.value !== 'date-asc');
    };

    details.addEventListener('click', event => {
      const button = event.target.closest('[data-sort-value]');
      if (!button) return;
      select.value = button.dataset.sortValue;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      details.open = false;
    });
    select.addEventListener('change', sync);
    select.addEventListener('sortsync', sync);
    details.addEventListener('toggle', () => {
      sync();
      if (details.open) {
        const filters = $('filters-disclosure');
        const settings = $('settings-menu');
        const info = $('info-menu');
        if (filters) filters.open = false;
        if (settings) settings.open = false;
        if (info) info.open = false;
      }
    });
    quick.appendChild(details);
    sync();
  }

  function setupFilters() {
    const filters = document.querySelector('.filters');
    const platformRow = document.querySelector('.platform-filter-row');
    const genreWrap = document.querySelector('.genre-filter-wrap');
    const status = $('status-filter');
    const precision = $('precision-filter');
    const period = document.querySelector('.period-control');
    const sort = $('sort-filter');
    const reset = $('reset-filters');
    const platformMemory = document.querySelector('.platform-memory');
    if (!filters || !platformRow || !genreWrap || !status || !precision || !period || !sort || !reset) return null;

    if (platformMemory) platformMemory.remove();

    const quick = document.createElement('div');
    quick.className = 'filter-quick-row';
    platformRow.parentNode.insertBefore(quick, platformRow);
    quick.appendChild(platformRow);

    const details = document.createElement('details');
    details.className = 'filters-disclosure';
    details.id = 'filters-disclosure';
    details.innerHTML = `
      <summary class="filter-summary" aria-label="Otevřít filtry">
        ${iconSliders()}
        <span class="filter-summary__label">Filtry</span>
        <span class="filter-summary__count" id="filter-summary-count" data-count="0"></span>
      </summary>
      <div class="filter-panel" role="group" aria-label="Další filtry">
        <div class="filter-panel__genres"></div>
        <div class="filter-controls-row"></div>
        <div class="filter-panel-footer">
          <button class="filter-done" id="filters-done" type="button">Hotovo</button>
        </div>
      </div>`;
    setupSortMenu(sort, quick);
    quick.appendChild(details);

    const genresSlot = details.querySelector('.filter-panel__genres');
    const controls = details.querySelector('.filter-controls-row');
    genresSlot.appendChild(genreWrap);
    controls.appendChild(status);
    controls.appendChild(precision);
    controls.appendChild(period);
    details.querySelector('.filter-panel-footer').insertBefore(reset, $('filters-done'));

    $('filters-done').addEventListener('click', () => { details.open = false; });
    details.addEventListener('toggle', () => {
      if (details.open) {
        const settings = $('settings-menu');
        const sorting = $('sort-disclosure');
        const info = $('info-menu');
        if (settings) settings.open = false;
        if (sorting) sorting.open = false;
        if (info) info.open = false;
      }
    });

    return platformMemory;
  }

  function setupInfo() {
    const actions = document.querySelector('.topbar__actions');
    if (!actions || $('info-menu')) return;

    const details = document.createElement('details');
    details.className = 'info-menu';
    details.id = 'info-menu';

    const summary = document.createElement('summary');
    summary.className = 'info-summary';
    summary.title = 'Jak GameS používat';
    summary.setAttribute('aria-label', 'Jak GameS používat');
    summary.innerHTML = `${iconInfo()}<span class="sr-only">Informace a ovládání</span>`;

    const popover = document.createElement('div');
    popover.className = 'info-popover';
    popover.innerHTML = `
      <div class="info-intro">
        <span class="info-kicker">Rychlý průvodce</span>
        <h3>Jsi tu nový?</h3>
        <p>GameS hlídá vydání her, obchody, ceny a předplatná. Tady je nejrychlejší způsob, jak se zorientovat.</p>
      </div>
      <div class="info-help-list" aria-label="Ovládání GameS">
        <div class="info-help-item"><span class="info-help-icon">↗</span><div><strong>Detail hry</strong><small>Klepni nebo klikni na kartu a zobrazí se termín, obchody, média a historie změn.</small></div></div>
        <div class="info-help-item"><span class="info-help-icon">⌕</span><div><strong>Hledání a filtry</strong><small>Použij lupu, platformy a Filtry. Na počítači otevře hledání také klávesa <kbd>/</kbd>.</small></div></div>
        <div class="info-help-item"><span class="info-help-icon">♡</span><div><strong>Sledované hry</strong><small>Srdcem si hru uložíš. Sledované hry pak můžeš filtrovat a používat pro upozornění nebo kalendář.</small></div></div>
        <div class="info-help-item"><span class="info-help-icon">⇆</span><div><strong>Gesta v detailu</strong><small>Na mobilu přejeď vlevo nebo vpravo pro předchozí či další hru. Gesta lze vypnout v Nastavení.</small></div></div>
        <div class="info-help-item"><span class="info-help-icon">◷</span><div><strong>Živá data</strong><small>Ceny a dostupnost obchodů se průběžně ověřují. Po načtení se karta nebo detail automaticky aktualizují.</small></div></div>
      </div>
      <div class="info-legend" aria-label="Význam značek a barev">
        <span class="info-section-title">Co znamenají značky a barvy</span>
        <div class="info-legend-list">
          <div class="info-legend-item">
            <span class="info-demo-badge info-demo-badge--soon">Nadcházející</span>
            <small>Datum vydání je dnes nebo v budoucnu. Zelená značí aktivní nebo aktuálně potvrzený stav.</small>
          </div>
          <div class="info-legend-item">
            <span class="info-demo-badge info-demo-badge--gamepass">Game Pass</span>
            <small>Hra je evidovaná v Game Pass. Detail může upřesnit PC, konzoli nebo cloud.</small>
          </div>
          <div class="info-legend-item">
            <span class="info-demo-price">od 1 499 Kč</span>
            <small><strong>od</strong> znamená nejnižší nalezenou odpovídající nabídku. U více edic se konečná cena může lišit.</small>
          </div>
          <div class="info-legend-item">
            <span class="info-demo-price is-stale">posl. 1 499 Kč</span>
            <small><strong>posl. známá</strong> je dříve ověřená cena, kterou obchod teď nepotvrdil. Nemusí být stále aktuální.</small>
          </div>
          <div class="info-legend-item">
            <span class="info-demo-badge info-demo-badge--early">Early Access</span>
            <small>Oranžová upozorňuje na předběžný nebo zvláštní stav, například Early Access.</small>
          </div>
        </div>
        <p class="info-color-note"><span class="info-color-dot info-color-dot--muted"></span>Šedá nebo přerušovaný okraj = starší / méně jistý údaj. Barvy ikon obchodů jen rozlišují zdroj.</p>
      </div>
      <div class="info-note"><strong>⚙ Nastavení</strong><span>Vzhled, moje platformy, zobrazení karet, upozornění a gesta.</span></div>
    `;

    details.append(summary, popover);
    const settings = $('settings-menu');
    actions.insertBefore(details, settings || actions.firstElementChild || null);

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const filters = $('filters-disclosure');
      const sorting = $('sort-disclosure');
      const settingsMenu = $('settings-menu');
      if (filters) filters.open = false;
      if (sorting) sorting.open = false;
      if (settingsMenu) settingsMenu.open = false;
    });
  }

  function setupSettings(platformMemory) {
    const actions = document.querySelector('.topbar__actions');
    const notification = $('notification-toggle');
    const viewToggle = document.querySelector('.view-toggle');
    if (!actions) return;

    const details = document.createElement('details');
    details.className = 'settings-menu';
    details.id = 'settings-menu';

    const summary = document.createElement('summary');
    summary.className = 'settings-summary';
    summary.title = 'Nastavení';
    summary.setAttribute('aria-label', 'Nastavení');
    summary.innerHTML = `${iconSettings()}<span class="sr-only">Nastavení</span>`;

    const popover = document.createElement('div');
    popover.className = 'settings-popover';
    popover.innerHTML = '<p class="settings-title">Nastavení</p>';

    const appearanceGroup = document.createElement('div');
    appearanceGroup.className = 'settings-group';
    const availableThemes = window.GameSThemes?.themes || [];
    appearanceGroup.innerHTML = `
      <span class="settings-group__label">Vzhled</span>
      <div class="settings-theme-grid" role="group" aria-label="Vzhled stránky">
        ${availableThemes.map(theme => `
          <button class="theme-choice" type="button" data-theme-choice="${theme.id}" aria-pressed="false">
            <span class="theme-choice__preview theme-preview--${theme.id}" aria-hidden="true"></span>
            <strong>${theme.name}</strong>
            <small>${theme.note}</small>
          </button>
        `).join('')}
      </div>`;
    appearanceGroup.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => window.GameSThemes?.apply(button.dataset.themeChoice, true));
    });
    popover.appendChild(appearanceGroup);
    window.GameSThemes?.apply(window.GameSThemes.getCurrent(), false);

    if (platformMemory) {
      const group = document.createElement('div');
      group.className = 'settings-group';
      group.innerHTML = '<span class="settings-group__label">Moje platformy</span>';
      group.appendChild(platformMemory);
      popover.appendChild(group);
    }

    if (viewToggle) {
      const group = document.createElement('div');
      group.className = 'settings-group';
      group.innerHTML = '<span class="settings-group__label">Zobrazení karet</span>';
      group.appendChild(viewToggle);
      popover.appendChild(group);
    }

    if (notification) {
      notification.remove();
      const group = document.createElement('div');
      group.className = 'settings-group';
      group.innerHTML = '<span class="settings-group__label">Upozornění</span>';
      const row = document.createElement('div');
      row.className = 'settings-notification-row';
      row.innerHTML = '<span>Sledované hry do 7 dní</span>';
      row.appendChild(notification);
      group.appendChild(row);
      popover.appendChild(group);
    }

    const versionGroup = document.createElement('div');
    versionGroup.className = 'settings-group settings-version';
    versionGroup.innerHTML = `
      <span class="settings-group__label">Verze webu</span>
      <div class="settings-version__row">
        <strong>v${window.GAMES_APP_VERSION || '—'}</strong>
        <span>aktuální nasazená verze</span>
      </div>`;
    popover.appendChild(versionGroup);

    details.append(summary, popover);
    actions.insertBefore(details, actions.firstElementChild || null);

    details.addEventListener('toggle', () => {
      if (details.open) {
        const filters = $('filters-disclosure');
        const sorting = $('sort-disclosure');
        const info = $('info-menu');
        if (filters) filters.open = false;
        if (sorting) sorting.open = false;
        if (info) info.open = false;
      }
    });
  }

  function closeMenusOutside(event) {
    const filters = $('filters-disclosure');
    const sorting = $('sort-disclosure');
    const settings = $('settings-menu');
    const info = $('info-menu');
    if (filters?.open && !filters.contains(event.target)) filters.open = false;
    if (sorting?.open && !sorting.contains(event.target)) sorting.open = false;
    if (settings?.open && !settings.contains(event.target)) settings.open = false;
    if (info?.open && !info.contains(event.target)) info.open = false;
  }

  function observeFilterState() {
    const root = document.querySelector('.filters-wrap');
    if (!root) return;
    let updateScheduled = false;
    const scheduleUpdate = () => {
      if (updateScheduled) return;
      updateScheduled = true;
      requestAnimationFrame(() => {
        updateScheduled = false;
        updateFilterBadge();
      });
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    root.addEventListener('click', () => setTimeout(scheduleUpdate, 0), true);
    root.addEventListener('change', () => setTimeout(scheduleUpdate, 0), true);
    setTimeout(scheduleUpdate, 0);
  }

  function setup() {
    if (document.documentElement.dataset.compactControls === '1') return;
    const platformMemory = setupFilters();
    setupSettings(platformMemory);
    setupInfo();
    observeFilterState();
    document.documentElement.dataset.compactControls = '1';
    document.addEventListener('pointerdown', closeMenusOutside);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const filters = $('filters-disclosure');
      const sorting = $('sort-disclosure');
      const settings = $('settings-menu');
      const info = $('info-menu');
      if (filters) filters.open = false;
      if (sorting) sorting.open = false;
      if (settings) settings.open = false;
      if (info) info.open = false;
    });
  }

  setup();
})();
