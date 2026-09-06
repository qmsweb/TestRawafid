/* ============================================
   روافد - التطبيق الحديث
   PWA، سلاسة التفاعل، وتحسينات التجربة
   ============================================ */
(function () {
  'use strict';

  var APP_NAME = 'منصة روافد';

  /* === 1. تسجيل خدمة العامل (Service Worker) === */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(function (err) {
          console.warn('تعذر تسجيل Service Worker:', err);
        });
    });
  }

  /* === 2. تحديث لون شريط المتصفح حسب الثيم === */
  function syncThemeColor() {
    var meta = document.getElementById('theme-color-meta');
    if (!meta) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    meta.setAttribute('content', isDark ? '#121212' : '#1a2ac6');
  }

  /* === 3. زر الصعود للأعلى === */
  function initBackToTop() {
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'العودة إلى الأعلى');
    btn.title = 'العودة إلى الأعلى';
    btn.innerHTML = '<i class="fas fa-chevron-up"></i>';
    document.body.appendChild(btn);

    var shown = false;
    function onScroll() {
      var shouldShow = window.scrollY > 420;
      if (shouldShow !== shown) {
        shown = shouldShow;
        btn.classList.toggle('visible', shouldShow);
      }
    }
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* === 4. كشف الظهور عند التمرير === */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      items.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    items.forEach(function (el) { observer.observe(el); });
  }

  /* === 5. تنبيه عدم الاتصال === */
  function initOfflineWatch() {
    var banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.innerHTML = '<i class="fas fa-wifi"></i> أنت غير متصل بالإنترنت - تعرض محتوى مُخزَّن';
    document.body.appendChild(banner);

    function update(status) {
      banner.classList.toggle('show', status === 'offline');
    }
    window.addEventListener('offline', function () { update('offline'); });
    window.addEventListener('online', function () { update('online'); });
    update(navigator.onLine ? 'online' : 'offline');
  }

  /* === 6. تثبيت التطبيق (Install Prompt) === */
  function initInstallPrompt() {
    var deferredPrompt = null;
    var lastDismiss = null;
    try { lastDismiss = localStorage.getItem('rawafid-pwa-dismiss'); } catch (e) {}

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;

      if (lastDismiss) {
        var days = (Date.now() - Number(lastDismiss)) / 86400000;
        if (days < 14) return;
      }
      showBanner();
    });

    function showBanner() {
      var banner = document.createElement('div');
      banner.className = 'pwa-install-banner';
      banner.innerHTML =
        '<img class="pwa-install-icon" src="/images/icon-192.png" alt="' + APP_NAME + '">' +
        '<div class="pwa-install-info">' +
          '<div class="pwa-install-title">ثبّت ' + APP_NAME + '</div>' +
          '<div class="pwa-install-sub">استخدم التطبيق بسرعة حتى بدون إنترنت</div>' +
        '</div>' +
        '<div class="pwa-install-actions">' +
          '<button class="pwa-install-btn">تثبيت</button>' +
          '<button class="pwa-install-close" aria-label="إغلاق">&times;</button>' +
        '</div>';

      document.body.appendChild(banner);

      requestAnimationFrame(function () { banner.classList.add('show'); });

      function dismiss() {
        banner.classList.remove('show');
        setTimeout(function () {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 500);
        try { localStorage.setItem('rawafid-pwa-dismiss', String(Date.now())); } catch (e) {}
      }

      banner.querySelector('.pwa-install-close').addEventListener('click', dismiss);

      banner.querySelector('.pwa-install-btn').addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          dismiss();
        });
      });
    }

    window.addEventListener('appinstalled', function () {
      try { localStorage.setItem('rawafid-pwa-dismiss', String(Date.now())); } catch (e) {}
    });
  }

  /* === 7. تشغيل كل شيء عند تحميل الصفحة === */
  document.addEventListener('DOMContentLoaded', function () {
    syncThemeColor();
    initBackToTop();
    initReveal();
    initOfflineWatch();
    initInstallPrompt();

    /* مزامنة لون الثيم عند تبديله (الزر الموجود في الهيدر) */
    var observer = new MutationObserver(function () { syncThemeColor(); });
    var html = document.documentElement;
    if (html && typeof MutationObserver !== 'undefined') {
      observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    }
  });
})();