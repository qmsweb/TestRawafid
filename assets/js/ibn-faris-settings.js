/* ============================================================
   ابن فارس — لوحة الإعدادات
   ============================================================
   • تُفتح من زر الترس داخل شريط ابن فارس العلوي (مكان زر الإغلاق).
   • نفس آلية نافذة ابن فارس العائمة:
       - الجوال (<768px): ورقة سفلية مع قفل تمرير الصفحة.
       - الشاشات الكبيرة: لوحة جانبية يمين تدفع المحتوى.
   • تعمل كتحسين تدريجي: بدون JavaScript يبقى زر الإعدادات ظاهراً
     لكن اللوحة لا تُفتح.
   ============================================================ */
(function () {
  "use strict";

  var state = {
    overlay: null,
    sheet: null,
    isOpen: false,
    sideMode: null,
    lastFocus: null,
    historyPushed: false,
    borrowedHistory: false,
    drag: null,
    noteTimer: null,
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

  function isSideMode() {
    return window.matchMedia("(min-width: 768px)").matches;
  }

  function ensureOverlay() {
    if (state.overlay) return state.overlay;

    var overlay = document.getElementById("ifs-overlay");
    if (!overlay) return null;

    state.overlay = overlay;
    state.sheet = overlay.querySelector(".ifs-sheet");

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    var handle = overlay.querySelector(".ifs-handle");
    if (handle) initDrag(handle);

    return overlay;
  }

  function focusables() {
    if (!state.sheet) return [];

    return Array.prototype.filter.call(
      state.sheet.querySelectorAll(
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

  function setPageInert(enabled) {
    var children = document.body.children;

    for (var index = 0; index < children.length; index += 1) {
      var element = children[index];
      if (element === state.overlay) continue;
      if (/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(element.tagName)) continue;

      if (enabled) {
        if (!element.hasAttribute("inert")) {
          element.setAttribute("inert", "");
          element.setAttribute("data-ifs-inert", "");
        }
      } else if (element.hasAttribute("data-ifs-inert")) {
        element.removeAttribute("inert");
        element.removeAttribute("data-ifs-inert");
      }
    }
  }

  function applyLayoutMode(force) {
    var side = isSideMode();
    if (!force && state.sideMode === side) return;
    state.sideMode = side;

    document.body.classList.toggle("ifs-side-open", side);
    document.body.classList.toggle("ifs-locked", !side);
    setPageInert(!side);

    if (state.sheet) {
      state.sheet.setAttribute("aria-modal", side ? "false" : "true");
    }

    if (side) {
      state.drag = null;
      if (state.overlay) state.overlay.classList.remove("is-dragging");
      if (state.sheet) state.sheet.style.transform = "";
    }
  }

  function clearNote() {
    var note = document.getElementById("ifs-note");
    if (!note) return;
    note.textContent = "";
    note.classList.remove("is-active");
  }

  // هل نافذة ابن فارس العائمة مفتوحة الآن؟ نغلقها قبل فتح الإعدادات
  // حتى لا تتراكم لوحتان فوق بعضهما.
  function isIbnFarisOpen() {
    var overlay = document.getElementById("if-overlay");
    return !!(
      overlay &&
      !overlay.hidden &&
      overlay.classList.contains("is-open")
    );
  }

  function focusReturnTarget(trigger) {
    // زر الترس داخل النافذة العائمة: بعد إغلاقها نعيد التركيز إلى
    // الزر العائم الظاهر بدل عنصر مخفي.
    if (trigger && trigger.closest && trigger.closest("#if-overlay")) {
      return document.querySelector(".if-fab") || trigger;
    }
    return (
      trigger ||
      (document.activeElement !== document.body ? document.activeElement : null)
    );
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

    var overlay = ensureOverlay();
    if (!overlay || !state.sheet) return;

    var fromIbnFaris = isIbnFarisOpen();
    state.lastFocus = focusReturnTarget(trigger);

    if (
      fromIbnFaris &&
      window.IbnFarisSheet &&
      typeof window.IbnFarisSheet.close === "function"
    ) {
      window.IbnFarisSheet.close(false, { skipHistory: true });
    }

    clearNote();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");

    // إجبار إعادة التنسيق حتى تعمل حركة الانزلاق.
    void overlay.offsetHeight;
    overlay.classList.add("is-open");
    applyLayoutMode(true);

    state.isOpen = true;
    // إذا فُتحت من نافذة ابن فارس فسجل التاريخ موجود أصلاً؛ نستخدمه
    // بدل إضافة سجل جديد حتى يعمل زر الرجوع في الجوال.
    state.borrowedHistory = fromIbnFaris;

    if (
      !state.borrowedHistory &&
      !state.historyPushed &&
      window.history &&
      history.pushState
    ) {
      try {
        history.pushState({ ibnfarisSettings: true }, "");
        state.historyPushed = true;
      } catch (error) {
        state.historyPushed = false;
      }
    }

    window.requestAnimationFrame(function () {
      var closeButton = state.sheet.querySelector("[data-ifs-close]");
      if (!closeButton) return;
      try {
        closeButton.focus({ preventScroll: true });
      } catch (error) {
        closeButton.focus();
      }
    });
  }

  function close(fromPopstate) {
    if (!state.isOpen || !state.overlay) return;

    var popHistory = state.historyPushed;
    state.historyPushed = false;
    state.borrowedHistory = false;

    state.isOpen = false;
    state.overlay.classList.remove("is-open", "is-dragging");
    state.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("ifs-locked", "ifs-side-open");
    setPageInert(false);
    state.sideMode = null;
    state.drag = null;
    if (state.sheet) state.sheet.style.transform = "";

    if (!fromPopstate && popHistory) {
      try {
        window.history.back();
      } catch (error) {
        // المتصفح لا يدعم التاريخ أو الحالة غير متاحة.
      }
    }

    window.setTimeout(function () {
      if (!state.isOpen && state.overlay) {
        state.overlay.hidden = true;
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
  // سحب الورقة السفلية لأسفل لإغلاقها (الجوال فقط)
  // ----------------------------------------------------------
  function initDrag(handle) {
    handle.addEventListener("pointerdown", function (event) {
      if (!state.isOpen || isSideMode()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      state.drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        distance: 0,
      };

      if (state.overlay) state.overlay.classList.add("is-dragging");

      if (event.cancelable) event.preventDefault();

      if (handle.setPointerCapture) {
        try {
          handle.setPointerCapture(event.pointerId);
        } catch (error) {}
      }
    });

    handle.addEventListener("pointermove", function (event) {
      if (!state.drag || event.pointerId !== state.drag.pointerId) return;
      if (!state.sheet) return;
      if (event.cancelable) event.preventDefault();

      var distance = Math.max(0, event.clientY - state.drag.startY);
      state.drag.distance = distance;
      state.sheet.style.transform =
        "translate3d(0, " + Math.round(distance) + "px, 0)";
    });

    function endDrag(event) {
      if (!state.drag || event.pointerId !== state.drag.pointerId) return;

      var distance = state.drag.distance;
      state.drag = null;

      if (handle.releasePointerCapture) {
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (error) {}
      }

      if (state.overlay) state.overlay.classList.remove("is-dragging");

      if (distance > 90) {
        close();
        return;
      }

      if (state.sheet) {
        window.requestAnimationFrame(function () {
          if (state.sheet && !state.drag) {
            state.sheet.style.transform = "";
          }
        });
      }
    }

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  // ----------------------------------------------------------
  // الأحداث
  // ----------------------------------------------------------
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

  document.addEventListener("keydown", function (event) {
    if (!state.isOpen) return;

    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab" || !state.sheet || isSideMode()) return;

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
  });

  window.addEventListener("resize", function () {
    if (state.isOpen) applyLayoutMode();
  });

  window.addEventListener("popstate", function () {
    if (state.isOpen) close(true);
  });

  window.IbnFarisSettings = { open: open, close: close };
})();
