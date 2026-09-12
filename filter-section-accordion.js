(() => {
  const STATE_KEY = 'games-calendar-filter-section-state-v1';

  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  const state = readState();

  function saveState(key, open) {
    state[key] = Boolean(open);
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  function summaryMarkup(label, key) {
    return `<summary class="filter-subsection__summary"><span>${label}</span><small data-filter-subsection-meta="${key}">Vše</small></summary>`;
  }

  function makeDetails(key, label, className = '') {
    const details = document.createElement('details');
    details.className = `filter-subsection ${className}`.trim();
    details.dataset.filterSection = key;
    details.open = state[key] === true;
    details.innerHTML = `${summaryMarkup(label, key)}<div class="filter-subsection__body"></div>`;
    details.addEventListener('toggle', () => saveState(key, details.open));
    return details;
  }

  function setupGenres() {
    const wrap = document.querySelector('.genre-filter-wrap');
    if (!wrap || wrap.dataset.accordionGenres === '1') return;
    const heading = wrap.querySelector(':scope > .genre-filter-heading');
    const list = wrap.querySelector(':scope > .genre-filter-list');
    if (!heading || !list) return;

    const details = makeDetails('genres', 'Žánry', 'filter-subsection--genres');
    const body = details.querySelector('.filter-subsection__body');
    const clear = heading.querySelector('#genre-clear');
    if (clear) {
      const actions = document.createElement('div');
      actions.className = 'filter-subsection__actions';
      actions.appendChild(clear);
      body.appendChild(actions);
    }
    body.appendChild(list);
    heading.remove();
    wrap.insertBefore(details, wrap.firstChild);
    wrap.dataset.accordionGenres = '1';
  }

  function setupTraitGroups() {
    document.querySelectorAll('.trait-filter-group').forEach(group => {
      if (group.dataset.accordionDone === '1') return;
      const labelEl = group.querySelector(':scope > .trait-filter-group__label');
      const list = group.querySelector(':scope > .trait-filter-list');
      if (!labelEl || !list) return;
      const label = labelEl.textContent.trim();
      const key = `traits-${label.toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}`;
      const details = makeDetails(key, label, 'filter-subsection--traits');
      details.dataset.traitGroup = group.dataset.traitGroup || key;
      details.dataset.traitPartition = group.dataset.traitPartition || '0';
      if (group.dataset.filterCoverage) details.dataset.filterCoverage = group.dataset.filterCoverage;
      if (group.dataset.filterTotal) details.dataset.filterTotal = group.dataset.filterTotal;
      details.querySelector('.filter-subsection__body').appendChild(list);
      group.replaceWith(details);
      details.dataset.accordionDone = '1';
    });
  }

  function setupSelection() {
    const row = document.querySelector('.filter-controls-row');
    if (!row || row.dataset.accordionSelection === '1') return;
    const controls = [...row.children].filter(node => node.matches?.('#status-filter,.period-control,#sort-filter'));
    if (!controls.length) return;

    const details = makeDetails('selection', 'Vydání a řazení', 'filter-subsection--selection');
    const body = details.querySelector('.filter-subsection__body');
    const inner = document.createElement('div');
    inner.className = 'filter-subsection__controls';
    controls.forEach(node => inner.appendChild(node));
    body.appendChild(inner);
    row.appendChild(details);
    row.dataset.accordionSelection = '1';
  }

  function activeCount(selector) {
    return document.querySelectorAll(selector).length;
  }

  function numeric(value) {
    const parsed = Number(String(value || '').replace(/[^0-9]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateMeta() {
    const genreMeta = document.querySelector('[data-filter-subsection-meta="genres"]');
    if (genreMeta) {
      const selected = activeCount('#genre-filters .genre-filter-chip.is-active');
      genreMeta.textContent = selected ? `${selected} vybráno` : 'Vše';
    }

    document.querySelectorAll('.filter-subsection--traits').forEach(details => {
      const meta = details.querySelector('[data-filter-subsection-meta]');
      if (!meta) return;
      const selected = details.querySelectorAll('[data-trait].is-active').length;
      if (selected) {
        meta.textContent = `${selected} vybráno`;
        return;
      }

      const coverage = numeric(details.dataset.filterCoverage);
      const total = numeric(details.dataset.filterTotal);
      const partition = details.dataset.traitPartition === '1';
      if (total) {
        meta.textContent = partition ? `${coverage} / ${total} her` : `${coverage} z ${total} her`;
        return;
      }

      const available = [...details.querySelectorAll('[data-trait]')].filter(node => !node.classList.contains('is-empty')).length;
      meta.textContent = `${available} možností`;
    });

    const selectionMeta = document.querySelector('[data-filter-subsection-meta="selection"]');
    if (selectionMeta) {
      const status = document.getElementById('status-filter');
      const sort = document.getElementById('sort-filter');
      const period = document.querySelector('[data-period].is-active');
      const parts = [];
      if (status?.selectedOptions?.[0]) parts.push(status.selectedOptions[0].textContent.trim());
      if (period) parts.push(period.textContent.trim());
      if (sort?.selectedOptions?.[0]) parts.push(sort.selectedOptions[0].textContent.trim());
      selectionMeta.textContent = parts.join(' · ') || 'Nastavit';
    }
  }

  function setup() {
    setupGenres();
    setupTraitGroups();
    setupSelection();
    updateMeta();
  }

  const observer = new MutationObserver(() => requestAnimationFrame(() => {
    setup();
    updateMeta();
  }));

  const root = document.querySelector('.filter-panel') || document.querySelector('.filters-wrap');
  if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-filter-coverage', 'data-filter-total'] });
  root?.addEventListener('click', () => setTimeout(updateMeta, 0), true);
  root?.addEventListener('change', () => setTimeout(updateMeta, 0), true);
  setup();
})();