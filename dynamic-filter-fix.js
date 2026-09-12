import { flattenReleases, loadGameData, todayLocal } from './js/data.js';

const $ = id => document.getElementById(id);
let scheduled = false;

function numberFrom(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function setHidden(node, hidden) {
  if (node && node.hidden !== hidden) node.hidden = hidden;
}

function syncTraitFilters() {
  document.querySelectorAll('[data-trait]').forEach(chip => {
    const count = numberFrom(chip.querySelector('[data-trait-count]')?.textContent);
    const group = chip.closest('[data-trait-group]');
    const total = numberFrom(group?.dataset.filterTotal);
    const active = chip.classList.contains('is-active');
    const useful = count > 0 && (!total || count < total);
    setHidden(chip, !active && !useful);
  });

  document.querySelectorAll('[data-trait-group]').forEach(group => {
    const visible = [...group.querySelectorAll('[data-trait]')].some(chip => !chip.hidden);
    setHidden(group, !visible);
  });

  const section = document.querySelector('.trait-filter-section');
  if (section) {
    const visible = [...section.querySelectorAll('[data-trait-group]')].some(group => !group.hidden);
    setHidden(section, !visible);
  }
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncTraitFilters();
  });
}

async function syncDatasetControls() {
  try {
    const result = await loadGameData();
    const dataset = result.dataset;
    const rows = flattenReleases(dataset);
    const games = dataset.games || [];
    const today = todayLocal();

    const hasRating = games.some(game => Number(game.rating || 0) > 0);
    const rating = $('sort-filter')?.querySelector('option[value="rating-desc"]');
    if (rating) {
      rating.hidden = !hasRating;
      rating.disabled = !hasRating;
      if (!hasRating && $('sort-filter').value === 'rating-desc') {
        $('sort-filter').value = 'date-asc';
        $('sort-filter').dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    const hasUpcoming = rows.some(row => !row.day || row.day >= today);
    const hasReleased = rows.some(row => row.day && row.day < today);
    const status = $('status-filter');
    const upcoming = status?.querySelector('option[value="upcoming"]');
    const released = status?.querySelector('option[value="released"]');

    if (upcoming) {
      upcoming.hidden = !hasUpcoming;
      upcoming.disabled = !hasUpcoming;
    }
    if (released) {
      released.hidden = !hasReleased;
      released.disabled = !hasReleased;
    }

    if (status?.value === 'upcoming' && !hasUpcoming) {
      status.value = 'all';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (status?.value === 'released' && !hasReleased) {
      status.value = 'all';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    }

    scheduleSync();
  } catch (error) {
    console.warn('Dynamic filters:', error);
  }
}

const root = document.querySelector('.filter-panel') || document.querySelector('.filters-wrap') || document.body;
new MutationObserver(scheduleSync).observe(root, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['class', 'data-filter-total', 'data-filter-coverage']
});

scheduleSync();
syncDatasetControls();
