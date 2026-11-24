// Bump VERSION on every deploy so phones pick up the new app shell.
const VERSION = 'v1';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/data.js', './js/engine.js', './js/routine.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// App shell: serve from cache instantly (gym signal is unreliable), refresh in the background.
// New deploys therefore show up on the launch after next. API calls are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request)
      .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })
      .catch(() => cached || c.match('./index.html'));
    return cached || network;
  }));
});
