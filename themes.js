(() => {
  const STORAGE_KEY = 'games-calendar-theme-v1';
  const DEFAULT_THEME = 'manager-dark';

  const THEMES = Object.freeze([
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
  ]);

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme.mode);
    document.documentElement.style.colorScheme = theme.mode;
  }

  function syncControls(theme) {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === theme.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
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

    syncControls(theme);
    window.dispatchEvent(new CustomEvent('games-theme-change', { detail: { theme: theme.id } }));
    return theme.id;
  }

  globalThis.GameSThemes = Object.freeze({
    themes: THEMES.map(theme => Object.freeze({ ...theme })),
    getCurrent: () => document.documentElement.dataset.theme || DEFAULT_THEME,
    apply: applyTheme
  });

  // Uložený vzhled se použije v <head> ještě před vykreslením stránky.
  applyTheme(storedTheme(), false);
})();
