const CACHE_NAME = 'blind-bourbon-derby-v9-do-not-press';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/claim-guard.js',
  './js/store.js',
  './js/scoring.js',
  './js/scoreboard.js',
  './js/easter-egg.js',
  './js/setup.js',
  './assets/derby-banner.webp',
  './assets/derby-logo.webp',
  './assets/derby-scorecard.webp',
  './assets/moose.webp',
  './assets/moose-bourbon-creek.webp',
  './assets/moose-moonshiner.webp',
  './assets/moose-game-show-host.webp',
  './assets/moose-king.webp',
  './assets/moose-shower-surprise.webp',
  './assets/biggest-loser-poop.webp',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(clients
        .filter((client) => new URL(client.url).searchParams.get('view') === 'scoreboard')
        .map((client) => client.navigate(client.url).catch(() => undefined))))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always pull the newest Firebase configuration when online.
  if (url.pathname.endsWith('/firebase-config.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Code must update on the first refresh. The old cache-first path could run
  // a stale scoreboard bundle once more while quietly refreshing it behind the
  // scenes, which made new TV features look missing.
  const isCodeAsset = url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.webmanifest');
  if (isCodeAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    })
  );
});
