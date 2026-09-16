(() => {
  const STORAGE_KEY = 'games-calendar-theme-v1';
  const DEFAULT_THEME = 'manager-dark';

  const THEMES = [
    {
      id: 'manager-dark',
      name: 'Manager tmavý',
      note: 'Nový výchozí vzhled',
      mode: 'dark',
      color: '#0b1020'
    },
    {
      id: 'games-dark',
      name: 'GameS tmavý',
      note: 'Původní růžovo-fialový',
      mode: 'dark',
      color: '#100719'
    },
    {
      id: 'manager-light',
      name: 'Manager světlý',
      note: 'Světlá verze Homebridge stylu',
      mode: 'light',
      color: '#f8fafc'
    },
    {
      id: 'games-light',
      name: 'GameS světlý',
      note: 'Světlá růžovo-fialová verze',
      mode: 'light',
      color: '#fff7fb'
    }
  ];

  const byId = new Map(THEMES.map(theme => [theme.id, theme]));

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return byId.has(value) ? value : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function updateBrowserChrome(theme) {
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', theme.color);

    const colorScheme = document.querySelector('meta[name="color-scheme"]');
    if (colorScheme) colorScheme.setAttribute('content', theme.mode);

    document.documentElement.style.colorScheme = theme.mode;
  }

  function applyTheme(id, persist = false) {
    const theme = byId.get(id) || byId.get(DEFAULT_THEME);
    document.documentElement.dataset.theme = theme.id;
    updateBrowserChrome(theme);

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme.id);
      } catch {
        // LocalStorage může být v soukromém režimu nedostupný.
      }
    }

    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === theme.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.title = `Vzhled: ${theme.name}`;
      toggle.setAttribute('aria-label', `Vzhled: ${theme.name}`);
    }

    window.dispatchEvent(new CustomEvent('games-theme-change', { detail: { theme: theme.id } }));
  }

  // Použije uložený vzhled ještě před vykreslením stránky.
  applyTheme(storedTheme(), false);

  function buildPicker() {
    const toggle = document.getElementById('theme-toggle');
    const actions = toggle?.closest('.topbar__actions');
    if (!toggle || !actions || document.getElementById('theme-picker')) return;

    const picker = document.createElement('div');
    picker.className = 'theme-picker';
    picker.id = 'theme-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Výběr vzhledu');

    picker.innerHTML = `
      <div class="theme-picker__head">
        <strong>Vzhled</strong>
        <span>2 tmavé · 2 světlé</span>
      </div>
      <div class="theme-picker__grid">
        ${THEMES.map(theme => `
          <button class="theme-choice" type="button" data-theme-choice="${theme.id}" aria-pressed="false">
            <span class="theme-choice__preview theme-preview--${theme.id}" aria-hidden="true"></span>
            <strong>${theme.name}</strong>
            <small>${theme.note}</small>
          </button>
        `).join('')}
      </div>
    `;

    actions.appendChild(picker);

    const closePicker = () => {
      picker.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };

    const openPicker = () => {
      picker.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    };

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      picker.hidden ? openPicker() : closePicker();
    });

    picker.addEventListener('click', event => {
      event.stopPropagation();
      const choice = event.target.closest('[data-theme-choice]');
      if (!choice) return;
      applyTheme(choice.dataset.themeChoice, true);
      closePicker();
    });

    document.addEventListener('click', closePicker);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePicker();
    });

    applyTheme(document.documentElement.dataset.theme || DEFAULT_THEME, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPicker, { once: true });
  } else {
    buildPicker();
  }
})();
