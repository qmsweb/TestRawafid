/* ============================================================
   ابن فارس — اللوحة السفلية العائمة
   ============================================================
   • تفتح محادثة ابن فارس فوق أي صفحة من صفحات روافد دون مغادرتها.
   • تُحمّل التنسيقات والسكربتات مرّة واحدة، عند أول فتح (أو عند
     المرور على الزر) حتى يبقى فتح اللوحة سريعاً وسلساً.
   • تعمل كتحسين تدريجي: بدون JavaScript يبقى الزر رابطاً إلى
     صفحة /ibn-faris/ كاملة.
   ============================================================ */
(function () {
  "use strict";

  var script = document.currentScript;
  var BASE = (script && script.getAttribute("data-base")) || "/";
  if (BASE.charAt(BASE.length - 1) !== "/") BASE += "/";

  var ASSETS = {
    css: BASE + "assets/css/ibn-faris.css",
    marked: BASE + "assets/js/vendor/marked.min.js",
    purify: BASE + "assets/js/vendor/purify.min.js",
    config: BASE + "assets/js/ibn-faris-config.js",
    engine: BASE + "assets/js/ibn-faris.js",
  };

  var state = {
    overlay: null,
    sheet: null,
    instance: null,
    lastFocus: null,
    isOpen: false,
    pending: false,
    ready: null,
    css: null,
  };

  // ----------------------------------------------------------
  // تحميل الموارد
  // ----------------------------------------------------------
  function loadCss() {
    if (state.css) return state.css;

    state.css = new Promise(function (resolve) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = ASSETS.css;
      link.setAttribute("data-ibnfaris-css", "");
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });

    return state.css;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var element = document.createElement("script");
      element.src = src;
      element.async = false;
      element.onload = function () {
        resolve();
      };
      element.onerror = function () {
        reject(new Error("ibnfaris_asset_failed"));
      };
      document.head.appendChild(element);
    });
  }

  function prefetch() {
    loadCss();
  }

  function ensureReady() {
    if (state.ready) return state.ready;

    state.ready = loadCss()
      .then(function () {
        return Promise.all([
          loadScript(ASSETS.marked),
          loadScript(ASSETS.purify),
          loadScript(ASSETS.config),
        ]);
      })
      .then(function () {
        return loadScript(ASSETS.engine);
      })
      .then(function () {
        if (!window.IbnFarisChat) throw new Error("ibnfaris_engine_missing");
      })
      .catch(function (error) {
        state.ready = null;
        throw error;
      });

    return state.ready;
  }

  // ----------------------------------------------------------
  // بناء اللوحة من القالب
  // ----------------------------------------------------------
  function ensureOverlay() {
    if (state.overlay) return state.overlay;

    var template = document.getElementById("if-widget-template");
    if (!template || !template.content) return null;

    document.body.appendChild(template.content.cloneNode(true));

    state.overlay = document.getElementById("if-overlay");
    if (!state.overlay) return null;

    state.sheet = state.overlay.querySelector(".if-sheet");

    state.overlay.addEventListener("click", function (event) {
      if (event.target === state.overlay) close();
    });

    state.overlay.addEventListener("click", function (event) {
      var closer = event.target.closest("[data-if-close]");
      if (!closer) return;
      event.preventDefault();
      close();
    });

    document.addEventListener("keydown", onKeydown);
    initSheetDrag();

    return state.overlay;
  }

  // ----------------------------------------------------------
  // سحب اللوحة لأعلى من المقبض
  // ----------------------------------------------------------
  var drag = null;

  function overlayMaxHeight() {
    if (!state.overlay) return 0;

    var styles = window.getComputedStyle(state.overlay);
    var padding =
      (parseFloat(styles.paddingTop) || 0) +
      (parseFloat(styles.paddingBottom) || 0);

    return Math.max(0, state.overlay.clientHeight - padding);
  }

  function measureBaseHeight() {
    if (!state.overlay || !state.sheet) return 0;

    var overlay = state.overlay;
    var sheet = state.sheet;
    var wasExpanded = overlay.classList.contains("is-expanded");
    var previousHeight = sheet.style.height;

    overlay.classList.remove("is-expanded");
    sheet.style.height = "";
    var height = sheet.getBoundingClientRect().height;
    sheet.style.height = previousHeight;
    if (wasExpanded) overlay.classList.add("is-expanded");

    return height;
  }

  function resetSheetSize() {
    drag = null;
    if (!state.overlay || !state.sheet) return;

    state.overlay.classList.remove("is-dragging", "is-expanded");
    state.sheet.style.height = "";
  }

  function onHandlePointerDown(event) {
    if (!state.isOpen || !state.sheet) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    var sheet = state.sheet;
    var overlay = state.overlay;
    var rect = sheet.getBoundingClientRect();
    var max = overlayMaxHeight();
    var base = Math.min(measureBaseHeight(), max);
    var startHeight = Math.min(rect.height, max);

    drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: startHeight,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      height: startHeight,
      base: base,
      max: max,
      wasExpanded: overlay.classList.contains("is-expanded"),
      handle: event.currentTarget,
    };

    sheet.style.height = startHeight + "px";
    overlay.classList.add("is-dragging");

    if (event.cancelable) event.preventDefault();

    var handle = event.currentTarget;
    if (handle.setPointerCapture) {
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {}
    }
  }

  function onHandlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();

    var now = event.timeStamp;
    if (now > drag.lastTime) {
      drag.velocity = (drag.lastY - event.clientY) / (now - drag.lastTime);
      drag.lastY = event.clientY;
      drag.lastTime = now;
    }

    var next = drag.startHeight + (drag.startY - event.clientY);
    // نسمح بالنزول تحت الارتفاع الأساسي حتى يمكن طيّ اللوحة بالكامل.
    next = Math.min(drag.max, Math.max(0, next));
    drag.height = next;
    state.sheet.style.height = Math.round(next) + "px";
  }

  function onHandlePointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var overlay = state.overlay;
    var sheet = state.sheet;
    var handle = drag.handle;
    var range = drag.max - drag.base;
    var extra = drag.height - drag.base;
    var velocity = drag.velocity;
    var base = drag.base;
    var max = drag.max;
    var wasExpanded = drag.wasExpanded;
    var dragHeight = drag.height;

    drag = null;

    if (handle && handle.releasePointerCapture) {
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (error) {}
    }

    // السحب لأسفل بمسافة كافية يطوي اللوحة بالكامل، لا يعيدها فقط.
    var closeThreshold = Math.max(60, base * 0.45);
    var shouldClose =
      dragHeight <= closeThreshold ||
      (velocity < -0.9 && dragHeight < base - 24);

    overlay.classList.remove("is-dragging");

    if (shouldClose) {
      close();
      return;
    }

    var shouldExpand;
    if (wasExpanded) {
      // من الوضع المكبّر: السحب لأعلى يبقيه مكبّرًا، وأي سحب واضح
      // لأسفل يعيد الحجم السابق، والسحب الكبير يطويه بالكامل.
      shouldExpand = true;
      if (extra < -16 || velocity < -0.55) shouldExpand = false;
    } else {
      var ratio = range > 0 ? extra / range : 0;
      if (velocity > 0.55) {
        shouldExpand = true;
      } else if (velocity < -0.55) {
        shouldExpand = false;
      } else {
        shouldExpand = ratio > 0.35;
      }
    }

    if (shouldExpand) {
      overlay.classList.add("is-expanded");
      sheet.style.height = max + "px";
      return;
    }

    overlay.classList.remove("is-expanded");
    sheet.style.height = base + "px";

    // بعد انتهاء الحركة نعيد الارتفاع للتنسيق الطبيعي.
    window.setTimeout(function () {
      if (!state.isOpen || drag) return;
      if (!overlay.classList.contains("is-expanded")) {
        sheet.style.height = "";
      }
    }, 320);
  }

  function initSheetDrag() {
    var handle =
      state.sheet && state.sheet.querySelector(".if-sheet-handle");
    if (!handle || handle.hasAttribute("data-if-drag")) return;

    handle.setAttribute("data-if-drag", "");
    handle.addEventListener("pointerdown", onHandlePointerDown);
    handle.addEventListener("pointermove", onHandlePointerMove);
    handle.addEventListener("pointerup", onHandlePointerUp);
    handle.addEventListener("pointercancel", onHandlePointerUp);
  }

  window.addEventListener("resize", function () {
    if (!state.isOpen || drag || !state.overlay) return;

    if (state.overlay.classList.contains("is-expanded")) {
      state.sheet.style.height = overlayMaxHeight() + "px";
    }
  });

  function focusables() {
    if (!state.sheet) return [];

    return Array.prototype.filter.call(
      state.sheet.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
      function (element) {
        return !!(
          element.offsetWidth ||
          element.offsetHeight ||
          element.getClientRects().length
        );
      }
    );
  }

  function setPageInert(enabled) {
    var children = document.body.children;

    for (var index = 0; index < children.length; index += 1) {
      var element = children[index];
      if (element === state.overlay) continue;
      if (/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(element.tagName)) continue;

      if (enabled) {
        if (!element.hasAttribute("inert")) {
          element.setAttribute("inert", "");
          element.setAttribute("data-if-inert", "");
        }
      } else if (element.hasAttribute("data-if-inert")) {
        element.removeAttribute("inert");
        element.removeAttribute("data-if-inert");
      }
    }
  }

  function onKeydown(event) {
    if (!state.isOpen) return;

    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab" || !state.sheet) return;

    var items = focusables();
    if (!items.length) return;

    var first = items[0];
    var last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ----------------------------------------------------------
  // الفتح والإغلاق
  // ----------------------------------------------------------
  function fallback(trigger) {
    var href =
      trigger && trigger.tagName === "A" && trigger.getAttribute("href");
    window.location.href = href || BASE + "ibn-faris/";
  }

  function open(trigger) {
    if (state.isOpen || state.pending) return;

    state.pending = true;
    state.lastFocus =
      trigger || (document.activeElement !== document.body
        ? document.activeElement
        : null);

    var overlay = ensureOverlay();

    ensureReady()
      .then(function () {
        var app = document.getElementById("if-app");
        if (!app) throw new Error("ibnfaris_app_missing");

        if (!state.instance) {
          state.instance =
            window.IbnFarisChat.mount(app, { focus: false }) ||
            app.__ibnFarisApi ||
            null;
        }

        overlay.hidden = false;
        overlay.setAttribute("aria-hidden", "false");

        // إجبار إعادة التنسيق حتى تعمل حركة الانزلاق.
        void overlay.offsetHeight;
        overlay.classList.add("is-open");
        document.body.classList.add("if-locked");
        setPageInert(true);

        state.isOpen = true;
        state.pending = false;

        window.requestAnimationFrame(function () {
          if (state.instance) {
            state.instance.focus();
            return;
          }
          var field = app.querySelector("#if-input");
          if (field && !field.disabled && !state.instance) {
            try {
              field.focus({ preventScroll: true });
            } catch (error) {
              field.focus();
            }
          }
        });
      })
      .catch(function () {
        state.pending = false;
        if (overlay) {
          overlay.hidden = true;
          overlay.setAttribute("aria-hidden", "true");
        }
        fallback(trigger);
      });
  }

  function close() {
    if (!state.isOpen || !state.overlay) return;

    state.isOpen = false;
    state.overlay.classList.remove("is-open");
    state.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("if-locked");
    setPageInert(false);

    window.setTimeout(function () {
      if (!state.isOpen && state.overlay) {
        state.overlay.hidden = true;
        resetSheetSize();
      }
    }, 320);

    var target = state.lastFocus;
    state.lastFocus = null;

    if (target && typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    }
  }

  // ----------------------------------------------------------
  // الأحداث
  // ----------------------------------------------------------
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;

    var trigger = event.target.closest("[data-if-open]");
    if (!trigger) return;

    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    open(trigger);
  });

  document.addEventListener(
    "pointerenter",
    function (event) {
      if (event.target.closest && event.target.closest("[data-if-open]")) {
        prefetch();
      }
    },
    true
  );

  document.addEventListener(
    "focusin",
    function (event) {
      if (event.target.closest && event.target.closest("[data-if-open]")) {
        prefetch();
      }
    },
    true
  );

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(prefetch, { timeout: 4000 });
  } else {
    window.setTimeout(prefetch, 2500);
  }

  window.IbnFarisSheet = { open: open, close: close };
})();
