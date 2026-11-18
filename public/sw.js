// Saaf Saans service worker: offline app shell + last-known live data.
const VERSION = 'saafsaans-v5';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;

const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/api.js',
  '/js/map.js',
  '/js/aqi.js',
  '/js/forecast.js',
  '/js/advisor.js',
  '/js/policy.js',
  '/icon.svg',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Add individually so one missing file does not break the install.
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // ignore POSTs (chat, reports)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore CDNs, tiles, fonts

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req, event));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) {
      // Flag the response so the page can show an "offline / saved data" banner.
      const headers = new Headers(cached.headers);
      headers.set('X-SW-Cache', '1');
      const body = await cached.blob();
      return new Response(body, { status: 200, statusText: 'OK (cached)', headers });
    }
    return new Response(JSON.stringify({ error: 'offline', message: 'Offline and no saved data.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const isNav = req.mode === 'navigate';
  const cached = await cache.match(req, { ignoreSearch: true }) || (isNav ? await cache.match('/index.html') : null);
  // Revalidate in the background so the shell stays fresh.
  const update = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  const res = await update;
  return res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}
