const VERSION = 'games-calendar-v3.6.0';
const SHELL_CACHE = `${VERSION}-shell`;
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
  './badge-filter-controls.js',
  './platform-filter-controls.js',
  './default-view.js',
  './filter-section-accordion.js',
  './detail-gesture-fix.js',
  './live-detail-enrichment.js',
  './watchlist-view-fix.js',
  './js/app.js',
  './js/data.js',
  './js/calendar.js',
  './js/ui.js',
  './manifest.webmanifest',
  './CaseyCZ.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== SHELL_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/games-lite.json') || url.pathname.endsWith('/games.json') || url.pathname.endsWith('games.json') || url.pathname.includes('/games-api/catalog')) {
    event.respondWith(fetch(request, { cache: 'default' }).catch(() => new Response(JSON.stringify({version:9,games:[]}), {
      status: 503,
      headers: {'Content-Type':'application/json'}
    })));
    return;
  }

  event.respondWith(cacheFirst(request));
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

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
