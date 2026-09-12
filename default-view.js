const hasExplicitView = (() => {
  const q = new URLSearchParams(location.search);
  return ['status','period','month','from','to','game','release'].some(key => q.has(key));
})();

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
