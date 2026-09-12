const PREF_KEY = 'games-calendar-platform-visibility-v1';

const PLATFORM_OPTIONS = [
  ['PC', 'PC', true],
  ['PS5', 'PlayStation 5', true],
  ['Xbox Series', 'Xbox Series X|S', true],
  ['Switch', 'Nintendo Switch', true],
  ['Switch 2', 'Nintendo Switch 2', true],
  ['VR', 'VR (vše)', true],
  ['PS4', 'PlayStation 4', false],
  ['Xbox One', 'Xbox One', false],
  ['macOS', 'macOS', false],
  ['Linux', 'Linux', false],
  ['Android', 'Android', false],
  ['iOS', 'iOS / iPadOS', false],
  ['Web', 'Web browser', false],
  ['SteamVR', 'SteamVR', false],
  ['PS VR2', 'PlayStation VR2', false],
  ['Meta Quest', 'Meta Quest / Oculus', false],
  ['Playdate', 'Playdate', false],
  ['Arcade', 'Arcade', false],
  ['Retro', 'Retro konzole', false],
  ['Other', 'Ostatní platformy', false]
];

const DEFAULTS = Object.fromEntries(PLATFORM_OPTIONS.map(([key, , enabled]) => [key, enabled]));
let prefs = readPrefs();

function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}

function syncControls() {
  document.querySelectorAll('[data-platform-visibility]').forEach(input => {
    input.checked = Boolean(prefs[input.dataset.platformVisibility]);
  });
}

function applyVisibility() {
  document.querySelectorAll('#platform-filters [data-platform]').forEach(button => {
    const key = button.dataset.platform;
    const visible = Boolean(prefs[key]);
    if (!visible && button.classList.contains('is-active')) {
      button.click();
      return;
    }
    button.hidden = !visible;
  });
  syncControls();
}

function ensureControls() {
  const host = document.querySelector('.trait-filter-section') || document.querySelector('.genre-filter-wrap');
  if (!host || host.querySelector('.platform-visibility-section')) return;

  const details = document.createElement('details');
  details.className = 'badge-visibility-section platform-visibility-section';
  details.innerHTML = `
    <summary class="badge-visibility-summary">
      <span>Platformy na hlavní stránce</span>
      <small>vyber, které filtry zobrazit</small>
    </summary>
    <div class="badge-visibility-body">
      <div class="badge-visibility-group">
        <span class="badge-visibility-label">Platformy</span>
        <div class="badge-visibility-list">
          ${PLATFORM_OPTIONS.map(([key, label]) => `
            <label class="advanced-setting badge-visibility-setting">
              <span>${label}</span>
              <input type="checkbox" data-platform-visibility="${key}" ${prefs[key] ? 'checked' : ''}>
              <i aria-hidden="true"></i>
            </label>`).join('')}
        </div>
      </div>
    </div>`;

  details.addEventListener('change', event => {
    const input = event.target.closest('[data-platform-visibility]');
    if (!input) return;
    prefs[input.dataset.platformVisibility] = input.checked;
    savePrefs();
    applyVisibility();
  });

  host.appendChild(details);
}

function setup() {
  ensureControls();
  applyVisibility();

  const observer = new MutationObserver(() => {
    ensureControls();
    applyVisibility();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();
