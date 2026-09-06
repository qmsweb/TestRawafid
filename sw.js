const FONT_CACHE = 'rawafid-fonts-v1';

const FONT_ASSETS = [
  '/fonts/fonts.css',
  '/fonts/thmanyahsans-Regular.otf',
  '/fonts/thmanyahsans-Light.otf',
  '/fonts/thmanyahsans-Medium.otf',
  '/fonts/thmanyahsans-Bold.otf',
  '/fonts/thmanyahsans-Black.otf',
  '/fonts/thmanyahseriftext-Black.otf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(FONT_CACHE).then((cache) => cache.addAll(FONT_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== FONT_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(FONT_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
