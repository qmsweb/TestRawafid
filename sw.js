/* ============================================
   روافد - Service Worker
   استراتيجيات: شبكة أولاً للصفحات، كاش أولاً للأصول
   ============================================ */
const CACHE_VERSION = 'rawafid-v1.0.0';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/modern.css',
  '/images/rawafid-1.png',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/maskable-icon-512.png'
];

const CDN_DOMAINS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* أصول ديناميكية يجب عدم كشفها أبداً (روابط خارجية مثل Google Drive) */
function shouldCache(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.pdf') || path.includes('/drive')) return false;
    return true;
  } catch (e) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.allSettled(
          CORE_ASSETS.map((url) => cache.add(url))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* تنقلات الصفحات: شبكة أولاً ثم كاش ثم النسخة المحلية من الرئيسية */
async function handleNavigation(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;
    return new Response('أنت غير متصل بالإنترنت حالياً.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* الأصول الثابتة: كاش أولاً مع تحديث خلفي */
async function handleAsset(request) {
  const cached = await caches.match(request);
  const cache = await caches.open(CACHE_VERSION);

  const revalidate = async () => {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok && shouldCache(request.url)) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch (err) {
      return null;
    }
  };

  if (cached) {
    revalidate();
    return cached;
  }

  const networkResponse = await revalidate();
  if (networkResponse) return networkResponse;

  if (request.mode === 'no-cors') {
    return new Response('', {
      status: 504,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  return new Response('غير متاح حالياً - تحقق من الاتصال.', {
    status: 504,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = CDN_DOMAINS.some((domain) => url.hostname.endsWith(domain));

  /* البيانات والموارد الخارجية: لا نكاشها */
  if (!isSameOrigin && !isCDN) return;

  /* تنقلات الصفحات */
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  /* الملفات الوسائط والأصول */
  event.respondWith(handleAsset(request));
});