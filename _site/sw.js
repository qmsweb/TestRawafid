const STATIC_CACHE = 'rawafid-static-v2';

// نُخزّن مسبقًا الملفات الصغيرة فقط. ملفات الخطوط الكبيرة تُخزَّن عند أول
// استخدام فعلي عبر معالج fetch أدناه، حتى لا يدفع الزائر ~1.4MB في أول زيارة.
const STATIC_ASSETS = [
  '/fonts/fonts.css',
  '/images/ibnfaris-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const shouldCache =
    url.pathname.startsWith('/fonts/') ||
    url.pathname.includes('/images/ibnfaris-icon.png');

  if (!shouldCache) return;

  // Cache-first: الشعار والخطوط لا تُحمّل من الشبكة كل مرة.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
