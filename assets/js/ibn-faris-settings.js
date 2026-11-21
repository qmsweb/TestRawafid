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
    voucher: null,
    voucherInputs: [],
    voucherTrigger: null,
    isVoucherOpen: false,
    voucherBusy: false,
    voucherTimer: null,
  };

  var ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  var PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

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

  function ensureVoucher() {
    if (state.voucher && document.contains(state.voucher)) return state.voucher;

    var view = document.getElementById("ifs-voucher");
    if (!view) return null;

    state.voucher = view;
    state.voucherInputs = Array.prototype.slice.call(
      view.querySelectorAll("[data-ifv-digit]")
    );
    return view;
  }

  // يقبل الأرقام العربية والفارسية ويحوّلها إلى أرقام لاتينية،
  // لأن رمز القسيمة يُخزَّن ويُقارَن بالأرقام اللاتينية فقط.
  function normalizeDigits(value) {
    var text = String(value == null ? "" : value);
    var digits = "";

    for (var i = 0; i < text.length; i += 1) {
      var character = text.charAt(i);
      var arabic = ARABIC_DIGITS.indexOf(character);
      var persian = PERSIAN_DIGITS.indexOf(character);

      if (arabic > -1) digits += String(arabic);
      else if (persian > -1) digits += String(persian);
      else if (character >= "0" && character <= "9") digits += character;
    }

    return digits.slice(0, 6);
  }

  function voucherCode() {
    var code = "";
    state.voucherInputs.forEach(function (input) {
      code += input.value || "";
    });
    return code;
  }

  function focusDigit(input) {
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
    if (input.value) input.select();
  }

  function setVoucherStatus(text, kind) {
    var status = state.voucher && state.voucher.querySelector("#ifv-status");
    if (!status) return;

    status.textContent = text || "";
    status.classList.toggle("is-error", kind === "error");
  }

  function clearVoucherInvalid() {
    var inputs = state.voucher && state.voucher.querySelector("#ifv-inputs");
    if (inputs) inputs.classList.remove("is-invalid");
  }

  function syncVoucher() {
    if (!state.voucher) return;

    var count = 0;
    state.voucherInputs.forEach(function (input) {
      var filled = input.value.length > 0;
      input.classList.toggle("is-filled", filled);
      if (filled) count += 1;
    });

    var submit = state.voucher.querySelector("#ifv-submit");
    if (submit) submit.disabled = state.voucherBusy || count < 6;

    return count;
  }

  function resetVoucher() {
    var view = ensureVoucher();
    if (!view) return;

    window.clearTimeout(state.voucherTimer);
    state.voucherBusy = false;

    view.classList.remove("is-success");

    var success = view.querySelector("#ifv-success");
    if (success) success.hidden = true;

    var form = view.querySelector("#ifv-form");
    if (form) form.reset();

    state.voucherInputs.forEach(function (input) {
      input.value = "";
      input.classList.remove("is-filled");
      input.disabled = false;
    });

    clearVoucherInvalid();
    setVoucherStatus("", "");

    var submit = view.querySelector("#ifv-submit");
    if (submit) {
      submit.classList.remove("is-loading");
      submit.disabled = true;
    }

    var label = view.querySelector(".ifv-submit-label");
    if (label) label.textContent = "تأكيد الرمز";
  }

  function openVoucher(trigger) {
    if (state.isVoucherOpen) return;

    var view = ensureVoucher();
    if (!view) return;

    if (!state.isOpen) open(trigger);

    state.voucherTrigger = trigger || null;
    if (trigger) trigger.setAttribute("aria-expanded", "true");

    resetVoucher();
    if (state.view) state.view.setAttribute("inert", "");

    view.hidden = false;
    view.setAttribute("aria-hidden", "false");
    state.isVoucherOpen = true;

    var body = view.querySelector(".ifs-body");
    if (body) body.scrollTop = 0;

    window.requestAnimationFrame(function () {
      focusDigit(state.voucherInputs[0]);
    });
  }

  // fromSettings = أُغلقت نافذة الإعدادات نفسها، فلا نعيد التركيز
  // إلى عنصر داخلها لأنه سيصبح مخفياً.
  function closeVoucher(fromSettings) {
    if (!state.isVoucherOpen) return;

    var view = state.voucher;
    var trigger = state.voucherTrigger;

    state.isVoucherOpen = false;
    state.voucherBusy = false;
    window.clearTimeout(state.voucherTimer);

    if (view) {
      view.hidden = true;
      view.setAttribute("aria-hidden", "true");
    }

    if (state.view) state.view.removeAttribute("inert");

    state.voucherTrigger = null;

    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (fromSettings || !trigger) return;

    try {
      trigger.focus({ preventScroll: true });
    } catch (error) {
      trigger.focus();
    }
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
    var scope = state.isVoucherOpen ? state.voucher : state.view;
    if (!scope) return [];

    return Array.prototype.filter.call(
      scope.querySelectorAll(
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

    closeVoucher(true);
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

  function handleDigitInput(input) {
    var index = Number(input.getAttribute("data-ifv-index")) || 0;
    var digits = normalizeDigits(input.value);
    var inputs = state.voucherInputs;

    if (!digits) {
      input.value = "";
      syncVoucher();
      return;
    }

    clearVoucherInvalid();
    setVoucherStatus("", "");

    if (digits.length > 1) {
      for (var i = 0; i < digits.length && index + i < inputs.length; i += 1) {
        inputs[index + i].value = digits.charAt(i);
      }
      focusDigit(inputs[Math.min(index + digits.length, inputs.length - 1)]);
    } else {
      input.value = digits;
      if (index < inputs.length - 1) focusDigit(inputs[index + 1]);
    }

    syncVoucher();
  }

  function handleDigitPaste(input, event) {
    var clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return;

    var digits = normalizeDigits(clipboard.getData("text"));
    if (!digits) return;

    event.preventDefault();

    var index = Number(input.getAttribute("data-ifv-index")) || 0;
    var start = digits.length >= state.voucherInputs.length ? 0 : index;

    for (
      var i = 0;
      i < digits.length && start + i < state.voucherInputs.length;
      i += 1
    ) {
      state.voucherInputs[start + i].value = digits.charAt(i);
    }

    clearVoucherInvalid();
    setVoucherStatus("", "");
    focusDigit(
      state.voucherInputs[
        Math.min(start + digits.length, state.voucherInputs.length - 1)
      ]
    );
    syncVoucher();
  }

  function handleDigitKeydown(input, event) {
    var index = Number(input.getAttribute("data-ifv-index")) || 0;
    var inputs = state.voucherInputs;

    if (event.key === "Backspace" && !input.value && index > 0) {
      event.preventDefault();
      inputs[index - 1].value = "";
      inputs[index - 1].classList.remove("is-filled");
      focusDigit(inputs[index - 1]);
      syncVoucher();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusDigit(inputs[index - 1]);
    } else if (event.key === "ArrowRight" && index < inputs.length - 1) {
      event.preventDefault();
      focusDigit(inputs[index + 1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusDigit(inputs[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusDigit(inputs[inputs.length - 1]);
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      clearVoucherInvalid();
      setVoucherStatus("", "");
    }
  }

  function showVoucherError() {
    var view = state.voucher;
    if (!view) return;

    var inputs = view.querySelector("#ifv-inputs");
    if (inputs) {
      inputs.classList.remove("is-invalid");
      void inputs.offsetWidth;
      inputs.classList.add("is-invalid");
    }

    setVoucherStatus(
      "الرمز غير صحيح أو منتهي الصلاحية. تحقّق منه وحاول مرة أخرى.",
      "error"
    );

    focusDigit(state.voucherInputs[0]);
  }

  function showVoucherSuccess() {
    var view = ensureVoucher();
    if (!view) return;

    var success = view.querySelector("#ifv-success");
    var again = view.querySelector("[data-ifv-again]");

    setVoucherStatus("", "");
    view.classList.add("is-success");
    if (success) success.hidden = false;

    state.voucherInputs.forEach(function (input) {
      input.disabled = true;
    });

    if (again) {
      try {
        again.focus({ preventScroll: true });
      } catch (error) {
        again.focus();
      }
    }
  }

  function submitVoucher() {
    var view = ensureVoucher();
    if (!view || state.voucherBusy) return;

    var code = voucherCode();
    if (code.length !== 6) {
      setVoucherStatus("أدخل الخانات الست كاملة قبل التأكيد.", "error");
      syncVoucher();
      focusDigit(state.voucherInputs[0]);
      return;
    }

    state.voucherBusy = true;
    clearVoucherInvalid();
    setVoucherStatus("جارٍ التحقق من الرمز…", "");

    var submit = view.querySelector("#ifv-submit");
    var label = view.querySelector(".ifv-submit-label");
    if (submit) submit.classList.add("is-loading");
    if (label) label.textContent = "جارٍ التحقق…";
    syncVoucher();

    // الواجهة جاهزة لربط خدمة القسائم لاحقاً. حالياً أي رمز صحيح
    // الشكل يُظهر حالة النجاح، والرمز 000000 يعاين حالة الخطأ.
    state.voucherTimer = window.setTimeout(function () {
      state.voucherBusy = false;
      if (submit) submit.classList.remove("is-loading");
      if (label) label.textContent = "تأكيد الرمز";
      syncVoucher();

      if (code === "000000") {
        showVoucherError();
      } else {
        showVoucherSuccess();
      }
    }, 900);
  }

  document.addEventListener("input", function (event) {
    if (!state.isVoucherOpen) return;
    var input = closestFrom(event.target, "[data-ifv-digit]");
    if (input) handleDigitInput(input);
  });

  document.addEventListener("paste", function (event) {
    if (!state.isVoucherOpen) return;
    var input = closestFrom(event.target, "[data-ifv-digit]");
    if (input) handleDigitPaste(input, event);
  });

  document.addEventListener("keydown", function (event) {
    if (!state.isVoucherOpen) return;
    var input = closestFrom(event.target, "[data-ifv-digit]");
    if (input) handleDigitKeydown(input, event);
  });

  document.addEventListener("submit", function (event) {
    var form = closestFrom(event.target, "#ifv-form");
    if (!form) return;
    event.preventDefault();
    submitVoucher();
  });

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;

    var voucherTrigger = closestFrom(event.target, "[data-ifs-voucher]");
    if (voucherTrigger) {
      event.preventDefault();
      openVoucher(voucherTrigger);
      return;
    }

    var voucherCloser = closestFrom(event.target, "[data-ifv-close]");
    if (voucherCloser) {
      event.preventDefault();
      closeVoucher();
      return;
    }

    var voucherAgain = closestFrom(event.target, "[data-ifv-again]");
    if (voucherAgain) {
      event.preventDefault();
      resetVoucher();
      focusDigit(state.voucherInputs[0]);
      return;
    }

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
        if (state.isVoucherOpen) closeVoucher();
        else close();
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

  window.IbnFarisSettings = {
    open: open,
    close: close,
    openVoucher: openVoucher,
    closeVoucher: closeVoucher,
  };
})();
