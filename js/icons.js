const COMMON = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';

const ICONS = Object.freeze({
  pc: `<svg ${COMMON}><path d="M3 5.5 10.5 4v7H3v-5.5Zm9-1.8L21 2v9h-9V3.7ZM3 13h7.5v7L3 18.5V13Zm9 0h9v9l-9-1.7V13Z" fill="currentColor"/></svg>`,
  playstation: `<svg ${COMMON}><path d="M8 5v14m0-14c4 0 7 1 7 4.2 0 2.6-2.3 3.6-5.2 3.6M4 16c3-1.8 6-2.4 9.2-2.5 3.2-.1 5.5.6 6.8 1.6-2.7 1.2-5.4 2-8 2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  xbox: `<svg ${COMMON}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 7.8c3 1.2 6 4.6 8.8 9.2M16.5 7.8c-3 1.2-6 4.6-8.8 9.2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`,
  nintendo: `<svg ${COMMON}><path d="M8.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.5V3Zm7 0H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2.5V3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.4" cy="8" r="1" fill="currentColor"/><circle cx="17.6" cy="15.7" r="1" fill="currentColor"/></svg>`,
  vr: `<svg ${COMMON}><path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5H15l-2-2h-2l-2 2H6.5A2.5 2.5 0 0 1 4 14.5v-5Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 11.5h2m-1-1v2m5-1h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  steam: `<svg ${COMMON}><circle cx="9" cy="15" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.8" cy="7.5" r="2.7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m11.7 13.4 3.1-3.4M4 13.5l2.7 1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  epic: '<span class="brand-icon__monogram">E</span>',
  gamepass: `<svg ${COMMON}><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m7.8 7.9 3.4 3.2m5-3.2-3.4 3.2m-1.6 0-3.6 5.2m5.2-5.2 3.6 5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  psplus: `<svg ${COMMON}><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  gfn: `<svg ${COMMON}><path d="M4 16.5V7.5h16v9H4Zm4-5.5h8M12 7.5v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  eaplay: '<span class="brand-icon__monogram">EA</span>',
  cloud: `<svg ${COMMON}><path d="M7.2 18h10.1a3.7 3.7 0 0 0 .4-7.4A5.8 5.8 0 0 0 6.6 9.2 4.4 4.4 0 0 0 7.2 18Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
});

const PLATFORM_BRANDS = Object.freeze({
  PC: 'pc',
  PS5: 'playstation',
  PS4: 'playstation',
  'Xbox Series': 'xbox',
  'Xbox One': 'xbox',
  Switch: 'nintendo',
  'Switch 2': 'nintendo',
  VR: 'vr'
});

const STORE_BRANDS = Object.freeze({
  steam: 'steam',
  epic: 'epic',
  playstation: 'playstation',
  xbox: 'xbox',
  nintendo: 'nintendo',
  meta: 'vr'
});

export function platformBrandKey(key = '') {
  return PLATFORM_BRANDS[key] || 'generic';
}

export function storeBrandKey(kind = '') {
  return STORE_BRANDS[kind] || kind || 'generic';
}

export function brandIconSvg(key = '') {
  return ICONS[key] || '<span class="brand-icon__monogram">•</span>';
}

export function brandIcon(key, { className = '', label = '' } = {}) {
  const safeKey = String(key || 'generic').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'generic';
  const aria = label ? ` role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
  return `<span class="brand-icon brand-icon--${safeKey}${className ? ` ${className}` : ''}"${aria}>${brandIconSvg(key)}</span>`;
}

export function platformIcon(key, options = {}) {
  return brandIcon(platformBrandKey(key), options);
}

export function storeIcon(kind, options = {}) {
  return brandIcon(storeBrandKey(kind), options);
}

export function serviceIcon(kind, options = {}) {
  return brandIcon(kind, options);
}
