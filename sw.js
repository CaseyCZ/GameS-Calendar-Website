const VERSION = 'games-calendar-v3.3.0';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './detail-polish.css',
  './layout-fixes.css',
  './compact-controls.css',
  './ui-upgrades.css',
  './advanced-features.css',
  './badge-filter-controls.css',
  './filter-section-accordion.css',
  './detail-gesture-fix.css',
  './compact-controls.js',
  './advanced-features.js',
  './release-tracker.js',
  './badge-filter-controls.js',
  './filter-section-accordion.js',
  './dynamic-filter-fix.js',
  './detail-gesture-fix.js',
  './live-detail-enrichment.js',
  './watchlist-view-fix.js',
  './js/app.js',
  './js/data.js',
  './js/calendar.js',
  './js/ui.js',
  './manifest.webmanifest',
  './CaseyCZ.png',
  './CaseyCZ.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => ![SHELL_CACHE, DATA_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API data must stay fresh and must never enter the static shell cache.
  if (url.pathname.startsWith('/games-api/') || url.pathname.startsWith('/api/') || url.pathname === '/games-health') return;

  if (url.pathname.endsWith('/games.json') || url.pathname.endsWith('games.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || new Response(JSON.stringify({version:5,games:[]}), {
      status: 503,
      headers: {'Content-Type':'application/json'}
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}
