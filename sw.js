const CACHE_NAME = 'blind-bourbon-derby-v18-strengthening-pass';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/tv-legibility.css',
  './js/app.js',
  './js/registration-draft.js',
  './js/claim-guard.js',
  './js/store.js',
  './js/registration.js',
  './js/finale.js',
  './js/scoring.js',
  './js/scoreboard.js',
  './js/game-rules.js',
  './js/easter-egg.js',
  './js/tasting-notes.js',
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
  './assets/award-honey-badger.webp',
  './assets/award-burning-money.webp',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest'
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn('Could not pre-cache app asset:', APP_SHELL[index], result.reason);
    }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell());
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

async function newestCodeOrCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/firebase-config.js')) {
    event.respondWith(newestCodeOrCache(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const isCodeAsset = url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.webmanifest');
  if (isCodeAsset) {
    event.respondWith(newestCodeOrCache(request));
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
    })
  );
});
