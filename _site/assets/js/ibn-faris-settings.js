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
    account: null,
    accountInput: null,
    accountTrigger: null,
    isAccountOpen: false,
    accountBusy: false,
    accountTimer: null,
  };

  var ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  var PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
  var NAME_MAX = 40;
  var NAME_STORAGE_KEY = "rawafed-ibn-faris-name";

  // الحروف العربية (بما فيها أشكال العرض) والتشكيل والإيموجي فقط.
  var ARABIC_LETTER =
    /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FC\u06FF\u0750-\u077F\u08A0-\u08C9\uFB50-\uFDFF\uFE70-\uFEFC]/;
  var ARABIC_MARK =
    /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/;
  var EMOJI_CHAR =
    /[\u200D\u20E3\uFE0F\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}]/u;
  var graphemeSegmenter = null;

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

  function ensureAccount() {
    if (state.account && document.contains(state.account)) return state.account;

    var view = document.getElementById("ifs-account");
    if (!view) return null;

    state.account = view;
    state.accountInput = view.querySelector("#ifu-name");
    return view;
  }

  function graphemeList(value) {
    var text = String(value == null ? "" : value);
    if (!text) return [];

    if (window.Intl && typeof window.Intl.Segmenter === "function") {
      try {
        if (!graphemeSegmenter) {
          graphemeSegmenter = new window.Intl.Segmenter("ar", {
            granularity: "grapheme",
          });
        }

        var segments = [];
        var iterator = graphemeSegmenter.segment(text)[Symbol.iterator]();
        var step = iterator.next();

        while (!step.done) {
          segments.push(step.value.segment);
          step = iterator.next();
        }

        return segments;
      } catch (error) {
        // نعود إلى تقسيم نقاط الترميز إن لم يتوفر المقطع النصي.
      }
    }

    return Array.from(text);
  }

  function isAllowedAccountCharacter(character) {
    return (
      character === " " ||
      ARABIC_LETTER.test(character) ||
      ARABIC_MARK.test(character) ||
      EMOJI_CHAR.test(character)
    );
  }

  function validateAccountName(value) {
    var cleaned = String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return { valid: false, reason: "empty", value: "" };

    var characters = Array.from(cleaned);

    for (var i = 0; i < characters.length; i += 1) {
      if (!isAllowedAccountCharacter(characters[i])) {
        return { valid: false, reason: "letters", value: cleaned };
      }
    }

    if (graphemeList(cleaned).length > NAME_MAX) {
      return { valid: false, reason: "long", value: cleaned };
    }

    return { valid: true, value: cleaned };
  }

  function readSavedName() {
    try {
      return window.localStorage.getItem(NAME_STORAGE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function writeSavedName(name) {
    try {
      window.localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch (error) {
      // الحفظ المحلي قد يكون معطلاً؛ لا نعطّل الواجهة بسببه.
    }
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
    closeAccount(true);

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

    if (state.view && !state.isAccountOpen) {
      state.view.removeAttribute("inert");
    }

    state.voucherTrigger = null;

    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (fromSettings || !trigger) return;

    try {
      trigger.focus({ preventScroll: true });
    } catch (error) {
      trigger.focus();
    }
  }

  function setAccountStatus(text, kind) {
    var status = state.account && state.account.querySelector("#ifu-status");
    if (!status) return;

    status.textContent = text || "";
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function syncAccount() {
    var view = ensureAccount();
    if (!view || !state.accountInput) return;

    var input = state.accountInput;
    var value = input.value;
    var trimmed = value.trim();
    var initial = graphemeList(trimmed)[0] || "";

    if (initial && !Array.from(initial).every(isAllowedAccountCharacter)) {
      initial = "";
    }

    var initialElement = view.querySelector("#ifu-initial");
    var glyph = view.querySelector("#ifu-avatar-glyph");
    var count = view.querySelector("#ifu-count");
    var submit = view.querySelector("#ifu-submit");
    var result = validateAccountName(value);

    if (initialElement) {
      initialElement.textContent = initial;
      initialElement.hidden = !initial;
    }

    if (glyph) glyph.hidden = !!initial;

    if (count) {
      count.textContent = graphemeList(value).length + " / " + NAME_MAX;
    }

    input.classList.toggle("is-invalid", !!trimmed && !result.valid);

    if (!trimmed) {
      setAccountStatus("", "");
    } else if (!result.valid) {
      setAccountStatus(
        result.reason === "long"
          ? "الاسم أطول من " + NAME_MAX + " حرفاً."
          : "استخدم الحروف العربية والتشكيل والإيموجي فقط.",
        "error"
      );
    } else {
      setAccountStatus("", "");
    }

    if (submit) submit.disabled = state.accountBusy || !result.valid;
  }

  function resetAccount() {
    var view = ensureAccount();
    if (!view) return;

    window.clearTimeout(state.accountTimer);
    state.accountBusy = false;

    var input = state.accountInput;
    if (input) {
      input.value = readSavedName();
      input.classList.remove("is-invalid");
      input.disabled = false;
    }

    var avatar = view.querySelector("#ifu-avatar");
    if (avatar) avatar.classList.remove("is-saved");

    var submit = view.querySelector("#ifu-submit");
    if (submit) {
      submit.classList.remove("is-loading");
      submit.disabled = true;
    }

    var label = view.querySelector(".ifu-submit-label");
    if (label) label.textContent = "حفظ الاسم";

    setAccountStatus("", "");
    syncAccount();
  }

  function openAccount(trigger) {
    if (state.isAccountOpen) return;

    var view = ensureAccount();
    if (!view) return;

    if (!state.isOpen) open(trigger);
    closeVoucher(true);

    state.accountTrigger = trigger || null;
    if (trigger) trigger.setAttribute("aria-expanded", "true");

    resetAccount();
    if (state.view) state.view.setAttribute("inert", "");

    view.hidden = false;
    view.setAttribute("aria-hidden", "false");
    state.isAccountOpen = true;

    var body = view.querySelector(".ifs-body");
    if (body) body.scrollTop = 0;

    window.requestAnimationFrame(function () {
      if (!state.accountInput) return;
      try {
        state.accountInput.focus({ preventScroll: true });
      } catch (error) {
        state.accountInput.focus();
      }
      state.accountInput.select();
    });
  }

  // fromSettings = أُغلقت نافذة الإعدادات نفسها، فلا نعيد التركيز
  // إلى عنصر داخلها لأنه سيصبح مخفياً.
  function closeAccount(fromSettings) {
    if (!state.isAccountOpen) return;

    var view = state.account;
    var trigger = state.accountTrigger;

    state.isAccountOpen = false;
    state.accountBusy = false;
    window.clearTimeout(state.accountTimer);

    if (view) {
      view.hidden = true;
      view.setAttribute("aria-hidden", "true");
    }

    if (state.view && !state.isVoucherOpen) {
      state.view.removeAttribute("inert");
    }

    state.accountTrigger = null;

    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (fromSettings || !trigger) return;

    try {
      trigger.focus({ preventScroll: true });
    } catch (error) {
      trigger.focus();
    }
  }

  function handleAccountInput() {
    var view = ensureAccount();
    if (!view || !state.accountInput) return;

    var input = state.accountInput;
    var graphemes = graphemeList(input.value);

    if (graphemes.length > NAME_MAX) {
      input.value = graphemes.slice(0, NAME_MAX).join("");
      input.setSelectionRange(input.value.length, input.value.length);
    }

    var avatar = view.querySelector("#ifu-avatar");
    if (avatar) avatar.classList.remove("is-saved");

    syncAccount();
  }

  function submitAccount() {
    var view = ensureAccount();
    if (!view || !state.accountInput || state.accountBusy) return;

    var input = state.accountInput;
    var result = validateAccountName(input.value);

    if (!result.valid) {
      setAccountStatus(
        result.reason === "empty"
          ? "اكتب اسمك أولاً."
          : result.reason === "long"
            ? "الاسم أطول من " + NAME_MAX + " حرفاً."
            : "استخدم الحروف العربية والتشكيل والإيموجي فقط.",
        "error"
      );
      input.focus();
      return;
    }

    var submit = view.querySelector("#ifu-submit");
    var label = view.querySelector(".ifu-submit-label");

    state.accountBusy = true;
    if (submit) {
      submit.classList.add("is-loading");
      submit.disabled = true;
    }
    if (label) label.textContent = "جارٍ الحفظ…";
    setAccountStatus("", "");

    // الحفظ محلي فقط في هذه المرحلة، إلى أن يُربط حساب المستخدم.
    state.accountTimer = window.setTimeout(function () {
      state.accountBusy = false;

      if (submit) submit.classList.remove("is-loading");
      if (label) label.textContent = "حفظ الاسم";

      input.value = result.value;
      writeSavedName(result.value);
      syncAccount();
      setAccountStatus("تم حفظ الاسم بنجاح.", "success");

      var avatar = view.querySelector("#ifu-avatar");
      if (avatar) avatar.classList.add("is-saved");
    }, 700);
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
    var scope = state.isAccountOpen
      ? state.account
      : state.isVoucherOpen
        ? state.voucher
        : state.view;
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

    closeAccount(true);
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
    if (state.isAccountOpen && closestFrom(event.target, "#ifu-name")) {
      handleAccountInput();
      return;
    }

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
    if (closestFrom(event.target, "#ifu-form")) {
      event.preventDefault();
      submitAccount();
      return;
    }

    var form = closestFrom(event.target, "#ifv-form");
    if (!form) return;
    event.preventDefault();
    submitVoucher();
  });

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;

    var accountTrigger = closestFrom(event.target, "[data-ifs-account]");
    if (accountTrigger) {
      event.preventDefault();
      openAccount(accountTrigger);
      return;
    }

    var accountCloser = closestFrom(event.target, "[data-ifu-close]");
    if (accountCloser) {
      event.preventDefault();
      closeAccount();
      return;
    }

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
        if (state.isAccountOpen) closeAccount();
        else if (state.isVoucherOpen) closeVoucher();
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
    openAccount: openAccount,
    closeAccount: closeAccount,
  };
})();
