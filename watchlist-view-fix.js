(() => {
  const SNAPSHOT_KEY = 'games-calendar-watchlist-view-snapshot-v1';

  function readSnapshot() {
    try { return JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null'); }
    catch { return null; }
  }

  function saveSnapshot(snapshot) {
    try {
      if (snapshot) sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      else sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch {}
  }

  function activePeriod() {
    return document.querySelector('[data-period].is-active')?.dataset.period || 'month';
  }

  function currentSnapshot() {
    const query = new URLSearchParams(location.search);
    return {
      status: document.getElementById('status-filter')?.value || 'upcoming',
      period: activePeriod(),
      month: query.get('month') || '',
      from: query.get('from') || '',
      to: query.get('to') || ''
    };
  }

  function selectStatus(value) {
    const status = document.getElementById('status-filter');
    if (!status || status.value === value) return;
    status.value = value;
    status.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectPeriod(value) {
    const button = document.querySelector(`[data-period="${CSS.escape(value)}"]`);
    if (button && !button.classList.contains('is-active')) button.click();
  }

  function selectMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(month || '')) return false;
    const tile = document.querySelector(`#month-rail [data-month="${CSS.escape(month)}"]`);
    if (!tile) return false;
    tile.click();
    return true;
  }

  function enterWatchlist() {
    saveSnapshot(currentSnapshot());
    selectStatus('all');
    selectPeriod('all');
  }

  function restorePreviousView() {
    const snapshot = readSnapshot();
    saveSnapshot(null);
    if (!snapshot) return;

    selectStatus(snapshot.status || 'upcoming');
    if (snapshot.period === 'next') {
      selectPeriod('next');
      return;
    }
    if (snapshot.period === 'all') {
      selectPeriod('all');
      return;
    }
    if (snapshot.period === 'month' && selectMonth(snapshot.month)) return;
    selectPeriod('month');
  }

  function setup() {
    const button = document.getElementById('watchlist-toggle');
    if (!button || button.dataset.watchlistViewFix === '1') return;
    button.dataset.watchlistViewFix = '1';

    button.addEventListener('click', () => {
      const leaving = button.classList.contains('is-active');
      if (leaving) {
        queueMicrotask(restorePreviousView);
      } else {
        enterWatchlist();
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
