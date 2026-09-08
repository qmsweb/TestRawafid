/* ============================================================
   نظام الثيمات الموحّد - روافد
   لإضافة ثيم جديد:
     1) أضف تعريفه في مصفوفة THEMES بالأسفل.
     2) أضف كتلة [data-theme="..."] داخل _includes/header.html.
     3) أضف الـ id إلى القائمة المحظورة في سكربت التهيئة باللوحات.
   ============================================================ */
(function () {
  'use strict';

  var THEMES = [
    { id: 'light',  label: 'النهاري',   color: '#1a2ac6' },
    { id: 'dark',   label: 'الليلي',    color: '#7986cb' },
    { id: 'pink',   label: 'الوردي',    color: '#d81b60' },
    { id: 'green',  label: 'الأخضر',    color: '#16a34a' },
    { id: 'purple', label: 'البنفسجي',  color: '#7c3aed' },
    { id: 'orange', label: 'البرتقالي', color: '#ea580c' }
  ];

  var VALID = {};
  THEMES.forEach(function (t) { VALID[t.id] = true; });

  function getCurrent() {
    var t = document.documentElement.getAttribute('data-theme');
    return VALID[t] ? t : 'light';
  }

  function applyTheme(id, save) {
    if (!VALID[id]) id = 'light';
    document.documentElement.setAttribute('data-theme', id);
    if (save !== false) {
      try { localStorage.setItem('rawafed-theme', id); } catch (e) {}
    }
    updatePicker(id);
  }

  /* عكس التوافق مع الصفحات القديمة التي تستدعي toggleTheme() */
  function cycleTheme() {
    var cur = getCurrent();
    var idx = 0;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === cur) { idx = i; break; }
    }
    applyTheme(THEMES[(idx + 1) % THEMES.length].id);
  }
  window.toggleTheme = cycleTheme;

  function updatePicker(activeId) {
    var picker = document.getElementById('theme-picker');
    if (!picker) return;
    var opts = picker.querySelectorAll('.theme-option');
    for (var i = 0; i < opts.length; i++) {
      var matched = opts[i].getAttribute('data-theme-id') === activeId;
      opts[i].classList.toggle('active', matched);
      var check = opts[i].querySelector('.theme-check');
      if (check) check.style.display = matched ? '' : 'none';
    }
  }

  function togglePicker(force) {
    var picker = document.getElementById('theme-picker');
    if (!picker) return;
    if (typeof force === 'boolean') {
      picker.classList.toggle('open', force);
    } else {
      picker.classList.toggle('open');
    }
  }

  function buildPicker() {
    var picker = document.getElementById('theme-picker');
    if (!picker || picker.querySelector('.theme-option')) return;
    var current = getCurrent();
    var html = '<div class="theme-picker-title">اختر المظهر</div>';
    THEMES.forEach(function (t) {
      html +=
        '<button type="button" class="theme-option' + (t.id === current ? ' active' : '') +
        '" data-theme-id="' + t.id + '" role="option">' +
        '<span class="theme-swatch" style="background:' + t.color + '"></span>' +
        '<span class="theme-label">' + t.label + '</span>' +
        '<span class="theme-check"' + (t.id === current ? '' : ' style="display:none"') + '>&#10003;</span>' +
        '</button>';
    });
    picker.innerHTML = html;
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem('rawafed-theme'); } catch (e) {}
    applyTheme(VALID[saved] ? saved : 'light', false);

    buildPicker();

    var navBtn = document.getElementById('theme-toggle-btn');
    var sideBtn = document.getElementById('sidebar-theme-toggle');
    var picker = document.getElementById('theme-picker');

    function openFrom(e, btn) {
      e.stopPropagation();
      e.preventDefault();
      if (btn && btn.classList.contains('open')) btn.classList.remove('open');
      togglePicker();
    }

    if (navBtn) {
      navBtn.addEventListener('click', function (e) { openFrom(e, navBtn); });
    }
    if (sideBtn) {
      sideBtn.addEventListener('click', function (e) { openFrom(e, sideBtn); });
    }

    if (picker) {
      picker.addEventListener('click', function (e) {
        var opt = e.target.closest ? e.target.closest('.theme-option') : null;
        if (opt) {
          applyTheme(opt.getAttribute('data-theme-id'));
          togglePicker(false);
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (picker && picker.classList.contains('open')) {
        var t = e.target;
        var inside = picker === t || picker.contains(t);
        if (!inside && t.id !== 'theme-toggle-btn' && t.id !== 'sidebar-theme-toggle') {
          togglePicker(false);
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') togglePicker(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();