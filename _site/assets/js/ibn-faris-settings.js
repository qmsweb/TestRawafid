/* ============================================================
   ابن فارس — تبويب الإعدادات
   ============================================================
   • يُفتح من زر الترس داخل شريط ابن فارس العلوي.
   • يظهر فوق المحادثة داخل اللوحة نفسها ولا يغلقها؛ عند الإغلاق
     تعود المحادثة كما كانت (نفس الرسائل ونفس موضع اللوحة).
   • يأخذ مقاس لوحة ابن فارس نفسه تلقائياً لأنه داخل الـ DOM الخاص
     بها، وليس لوحة أو نافذة منفصلة.
   ============================================================ */
(function () {
  "use strict";

  var state = {
    view: null,
    app: null,
    trigger: null,
    isOpen: false,
    lastFocus: null,
    noteTimer: null,
    observer: null,
    observedOverlay: null,
  };

  function elementFrom(target) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  }

  function closestFrom(target, selector) {
    var element = elementFrom(target);
    return element && element.closest ? element.closest(selector) : null;
  }

  function ensureView() {
    if (state.view && document.contains(state.view)) return state.view;

    var view = document.getElementById("ifs-view");
    if (!view) return null;

    state.view = view;
    state.app = view.parentElement;
    observeParent();
    return view;
  }

  // لوحة ابن فارس العائمة تبقى في الـ DOM بعد فتحها. إذا أُغلقت
  // (بالسحب أو النقر خارجها) نعيد تبويب الإعدادات إلى حالته الأولى
  // حتى تظهر المحادثة عند فتح اللوحة مرة أخرى.
  function observeParent() {
    var overlay = document.getElementById("if-overlay");
    if (!overlay || state.observedOverlay === overlay) return;
    if (!window.MutationObserver) return;

    state.observedOverlay = overlay;
    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver(function () {
      if (
        !state.isOpen ||
        (!overlay.classList.contains("is-open") || overlay.hidden)
      ) {
        close(true);
      }
    });

    state.observer.observe(overlay, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
  }

  function chatParts() {
    if (!state.app) return [];

    return Array.prototype.filter.call(state.app.children, function (element) {
      return (
        element.classList.contains("if-topbar") ||
        element.classList.contains("if-main") ||
        element.classList.contains("if-composer-shell")
      );
    });
  }

  function setChatInert(enabled) {
    chatParts().forEach(function (element) {
      if (enabled) {
        element.setAttribute("inert", "");
        element.setAttribute("data-ifs-inert", "");
      } else if (element.hasAttribute("data-ifs-inert")) {
        element.removeAttribute("inert");
        element.removeAttribute("data-ifs-inert");
      }
    });
  }

  function focusables() {
    if (!state.view) return [];

    return Array.prototype.filter.call(
      state.view.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  function clearNote() {
    var note = document.getElementById("ifs-note");
    if (!note) return;
    note.textContent = "";
    note.classList.remove("is-active");
  }

  function showNote(text) {
    var note = document.getElementById("ifs-note");
    if (!note) return;

    window.clearTimeout(state.noteTimer);
    note.textContent = "سيتوفر «" + text + "» قريباً.";
    note.classList.add("is-active");

    state.noteTimer = window.setTimeout(function () {
      note.textContent = "";
      note.classList.remove("is-active");
    }, 4200);
  }

  function open(trigger) {
    if (state.isOpen) return;

    var view = ensureView();
    if (!view) return;

    state.trigger = trigger;
    state.lastFocus =
      trigger ||
      (document.activeElement !== document.body ? document.activeElement : null);

    if (trigger) trigger.setAttribute("aria-expanded", "true");

    clearNote();
    view.hidden = false;
    view.setAttribute("aria-hidden", "false");
    setChatInert(true);
    state.isOpen = true;

    window.requestAnimationFrame(function () {
      var closeButton = view.querySelector("[data-ifs-close]");
      if (!closeButton) return;
      try {
        closeButton.focus({ preventScroll: true });
      } catch (error) {
        closeButton.focus();
      }
    });
  }

  // fromParent = أُغلقت لوحة ابن فارس نفسها، فلا نعيد التركيز لعنصر
  // داخلها. عند الإغلاق العادي يعود التركيز إلى زر الترس في المحادثة.
  function close(fromParent) {
    if (!state.isOpen || !state.view) return;

    state.isOpen = false;
    state.view.hidden = true;
    state.view.setAttribute("aria-hidden", "true");
    setChatInert(false);

    if (state.trigger) {
      state.trigger.setAttribute("aria-expanded", "false");
      state.trigger = null;
    }

    var target = state.lastFocus;
    state.lastFocus = null;

    if (fromParent) return;

    if (target && typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    }
  }

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;

    var trigger = closestFrom(event.target, "[data-ifs-open]");
    if (trigger) {
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
      return;
    }

    var closer = closestFrom(event.target, "[data-ifs-close]");
    if (closer) {
      event.preventDefault();
      close();
      return;
    }

    var soon = closestFrom(event.target, "[data-ifs-soon]");
    if (soon) {
      event.preventDefault();
      showNote(soon.getAttribute("data-ifs-soon") || "");
    }
  });

  // في مرحلة الالتقاط كي لا يغلق Escape لوحة ابن فارس كلها؛
  // نغلقه فقط ونعيد المستخدم إلى المحادثة.
  document.addEventListener(
    "keydown",
    function (event) {
      if (!state.isOpen) return;

      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }

      if (event.key !== "Tab") return;

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
    },
    true
  );

  window.IbnFarisSettings = { open: open, close: close };
})();
