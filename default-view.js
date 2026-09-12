const explicitKeys = ['status','period','month','from','to','game','release'];
const initialQuery = new URLSearchParams(location.search);
const hasExplicitView = explicitKeys.some(key => initialQuery.has(key));

if (!hasExplicitView) {
  initialQuery.set('status', 'all');
  initialQuery.set('period', 'all');
  history.replaceState(null, '', `${location.pathname}?${initialQuery}${location.hash}`);
}

function applyAllView() {
  const status = document.getElementById('status-filter');
  const allPeriod = document.querySelector('[data-period="all"]');
  if (!status || !allPeriod) return false;

  if (status.value !== 'all') {
    status.value = 'all';
    status.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (!allPeriod.classList.contains('is-active')) allPeriod.click();
  return true;
}

function setup() {
  if (!hasExplicitView) queueMicrotask(applyAllView);

  for (const id of ['reset-filters', 'empty-reset']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.addEventListener('click', () => queueMicrotask(applyAllView));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();
