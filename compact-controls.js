(() => {
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'games-calendar-theme';

  function ensureUpgradeStyles() {
    if (document.querySelector('link[data-ui-upgrades]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'ui-upgrades.css';
    link.dataset.uiUpgrades = '1';
    document.head.appendChild(link);
  }

  function preferredTheme() {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme, persist = false) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    if (persist) localStorage.setItem(THEME_KEY, next);
    const color = next === 'light' ? '#f7f4f9' : '#100719';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    document.querySelectorAll('[data-theme-option]').forEach(button => {
      const active = button.dataset.themeOption === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function iconSliders() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6"/></svg>';
  }

  function iconSettings() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.37a1.7 1.7 0 0 0-1 .63 1.7 1.7 0 0 0-.37 1.08V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.23 15a1.7 1.7 0 0 0-.63-1 1.7 1.7 0 0 0-1.08-.37H2.5v-4h.08A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.57 4.2a1.7 1.7 0 0 0 1-.63A1.7 1.7 0 0 0 9.94 2.5V2h4v.08A1.7 1.7 0 0 0 15 3.7a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 8a1.7 1.7 0 0 0 .63 1 1.7 1.7 0 0 0 1.08.37H21.5v4h-.08A1.7 1.7 0 0 0 19.8 14a1.7 1.7 0 0 0-.4 1Z"/></svg>';
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
    const sort = $('sort-filter');
    const activePeriod = document.querySelector('[data-period].is-active');
    const contextCount = document.querySelectorAll('#active-context-filters .context-filter').length;
    let count = genreCount + contextCount;
    if (status && status.value !== 'upcoming') count += 1;
    if (sort && sort.value !== 'date-asc') count += 1;
    if (activePeriod && activePeriod.dataset.period !== 'month') count += 1;
    return count;
  }

  function updateFilterBadge() {
    const badge = $('filter-summary-count');
    const summary = document.querySelector('.filter-summary');
    if (!badge || !summary) return;
    const count = activeFilterCount();
    badge.dataset.count = String(count);
    badge.textContent = count ? String(count) : '';
    summary.classList.toggle('has-active', count > 0);
  }

  function setupFilters() {
    const filters = document.querySelector('.filters');
    const platformRow = document.querySelector('.platform-filter-row');
    const genreWrap = document.querySelector('.genre-filter-wrap');
    const status = $('status-filter');
    const period = document.querySelector('.period-control');
    const sort = $('sort-filter');
    const reset = $('reset-filters');
    const platformMemory = document.querySelector('.platform-memory');
    if (!filters || !platformRow || !genreWrap || !status || !period || !sort || !reset) return null;

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
    quick.appendChild(details);

    const genresSlot = details.querySelector('.filter-panel__genres');
    const controls = details.querySelector('.filter-controls-row');
    genresSlot.appendChild(genreWrap);
    controls.appendChild(status);
    controls.appendChild(period);
    controls.appendChild(sort);
    details.querySelector('.filter-panel-footer').insertBefore(reset, $('filters-done'));

    $('filters-done').addEventListener('click', () => { details.open = false; });
    details.addEventListener('toggle', () => {
      if (details.open) {
        const settings = $('settings-menu');
        if (settings) settings.open = false;
      }
    });

    return platformMemory;
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
    appearanceGroup.innerHTML = `
      <span class="settings-group__label">Vzhled</span>
      <div class="theme-choice" role="group" aria-label="Vzhled stránky">
        <button class="theme-choice__button" type="button" data-theme-option="dark" aria-pressed="false">${iconMoon()}<span>Tmavý</span></button>
        <button class="theme-choice__button" type="button" data-theme-option="light" aria-pressed="false">${iconSun()}<span>Světlý</span></button>
      </div>`;
    appearanceGroup.querySelectorAll('[data-theme-option]').forEach(button => {
      button.addEventListener('click', () => applyTheme(button.dataset.themeOption, true));
    });
    popover.appendChild(appearanceGroup);

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

    details.append(summary, popover);
    actions.insertBefore(details, actions.firstChild?.nextSibling || null);
    applyTheme(preferredTheme());

    details.addEventListener('toggle', () => {
      if (details.open) {
        const filters = $('filters-disclosure');
        if (filters) filters.open = false;
      }
    });
  }

  function closeMenusOutside(event) {
    const filters = $('filters-disclosure');
    const settings = $('settings-menu');
    if (filters?.open && !filters.contains(event.target)) filters.open = false;
    if (settings?.open && !settings.contains(event.target)) settings.open = false;
  }

  function observeFilterState() {
    const root = document.querySelector('.filters-wrap');
    if (!root) return;
    const observer = new MutationObserver(() => requestAnimationFrame(updateFilterBadge));
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    root.addEventListener('click', () => setTimeout(updateFilterBadge, 0), true);
    root.addEventListener('change', () => setTimeout(updateFilterBadge, 0), true);
    setTimeout(updateFilterBadge, 0);
  }

  function setup() {
    ensureUpgradeStyles();
    applyTheme(preferredTheme());
    if (document.documentElement.dataset.compactControls === '1') return;
    document.documentElement.dataset.compactControls = '1';
    const platformMemory = setupFilters();
    setupSettings(platformMemory);
    observeFilterState();
    document.addEventListener('pointerdown', closeMenusOutside);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const filters = $('filters-disclosure');
      const settings = $('settings-menu');
      if (filters) filters.open = false;
      if (settings) settings.open = false;
    });
  }

  setup();
  import('./advanced-features.js').catch(error => console.warn('Advanced features:', error));
})();
