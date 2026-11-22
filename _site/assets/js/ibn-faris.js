/* ============================================================
   ابن فارس — واجهة المحادثة
   ============================================================
   • تتصل بدالة Supabase: functions/v1/ibn-faris-chat
   • تستقبل بثّ SSE مبسّطاً: answer / sources / status / quota / error
   • تحفظ المحادثة الأخيرة في sessionStorage (حتى إغلاق التبويب) وتستعيدها
     عند إعادة تحميل الصفحة أو الانتقال إلى صفحة أخرى، وتحتفظ بمسودة الكتابة
     في sessionStorage أيضاً.
   • تُركَّب على أي حاوية تحمل #if-app:
       صفحة /ibn-faris/  أو  اللوحة السفلية العائمة في بقية الصفحات.
   ============================================================ */
(function () {
  "use strict";

  var CONFIG = window.IBNAFARIS_CONFIG || {};
  var SUPABASE_URL = String(CONFIG.supabaseUrl || "").replace(/\/+$/, "");
  var ANON_KEY = String(CONFIG.supabaseAnonKey || "");
  var FUNCTION_NAME = CONFIG.functionName || "ibn-faris-chat";
  var MAX_HISTORY = Math.max(2, Number(CONFIG.maxHistory) || 12);
  var ENDPOINT = SUPABASE_URL
    ? SUPABASE_URL + "/functions/v1/" + FUNCTION_NAME
    : "";
  // الدخول عبر Google اختياري: تُرسل جلسة المستخدم إن وُجدت، وإلا يعتمد
  // الخادم على بصمة الجهاز للحصة اليومية. لا يُمنع السؤال بلا جلسة.
  var AUTH = window.RawafidAuth || null;
  var DRAFT_KEY = "ibnfaris-rawafid-draft";
  var HISTORY_KEY = "ibnfaris-rawafid-history";
  var HISTORY_VERSION = 2;
  var HISTORY_SAVE_DELAY = 800;
  // نحفظ المحادثة في sessionStorage (تنتهي بإغلاق التبويب) ونضع سقفًا
  // للحجم والمدة حتى لا تتحول إلى أرشيف دائم على جهاز المستخدم.
  var HISTORY_MAX_CHARS = 120_000;
  var HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function authToken() {
    return AUTH && typeof AUTH.getAccessToken === "function"
      ? AUTH.getAccessToken()
      : null;
  }

  // ----------------------------------------------------------
  // قياس المساحة المرئية فعلياً (يتغيّر مع لوحة المفاتيح على الجوال)
  // نضبط متغيّرات CSS حتى يبقى شريط الإدخال فوق لوحة المفاتيح.
  // ----------------------------------------------------------
  function syncViewport() {
    var viewport = window.visualViewport;
    if (!viewport) return;

    var root = document.documentElement;
    var keyboard = Math.max(
      0,
      window.innerHeight - viewport.height - viewport.offsetTop
    );

    root.style.setProperty("--if-vv-h", Math.round(viewport.height) + "px");
    root.style.setProperty("--if-kb", Math.round(keyboard) + "px");

    var overlay = document.getElementById("if-overlay");
    if (overlay) overlay.classList.toggle("is-keyboard", keyboard > 80);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport);
    window.visualViewport.addEventListener("scroll", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    syncViewport();
  }

  function mount(root, options) {
    if (!root) return null;
    if (root.getAttribute("data-ibnfaris-mounted") === "true") return null;
    root.setAttribute("data-ibnfaris-mounted", "true");

    var settings = options || {};
    var q = function (selector) {
      return root.querySelector(selector);
    };

    var els = {
      main: q("#if-main"),
      empty: q("#if-empty"),
      messages: q("#if-messages"),
      live: q("#if-live"),
      form: q("#if-form"),
      input: q("#if-input"),
      send: q("#if-send"),
      stop: q("#if-stop"),
      alert: q("#if-alert"),
      alertText: q("#if-alert-text"),
      newChat: q("#if-new"),
      quota: q("#if-quota"),
      quotaValue: q("#if-quota-value"),
      quotaCount: q("#if-quota-count"),
      jump: q("#if-jump"),
      confirm: q("#if-confirm"),
      confirmCancel: q("#if-confirm-cancel"),
      confirmOk: q("#if-confirm-ok"),
    };

    if (!els.main || !els.form || !els.input || !els.messages) return null;

    var state = {
      messages: [],
      streaming: false,
      controller: null,
      quota: null,
      quotaExhausted: false,
      authResolved: false,
      signedIn: false,
      authUnsub: null,
      renderTimer: null,
      lastRenderAt: 0,
      saveTimer: null,
      stick: true,
      turn: 0,
    };

    // ----------------------------------------------------------
    // التنبيهات
    // ----------------------------------------------------------
    function showAlert(message, tone) {
      if (!els.alert || !els.alertText) return;
      els.alertText.textContent = String(message || "");
      els.alert.classList.toggle("is-quota", tone === "quota");
      els.alert.hidden = false;
    }

    function hideAlert() {
      if (els.alert) els.alert.hidden = true;
    }

    // منطقة إعلان منفصلة عن المحتوى المتدفق حتى لا يقرأ قارئ الشاشة
    // الرسالة كاملة مع كل تحديث أثناء البث.
    function announce(text) {
      if (!els.live) return;
      els.live.textContent = "";
      window.setTimeout(function () {
        els.live.textContent = String(text || "");
      }, 30);
    }

    // نص مبسّط لقارئ الشاشة: لا نقرأ رموز Markdown نفسها.
    function naturalText(value) {
      return String(value || "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~#>]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // ----------------------------------------------------------
    // حالة الدخول (اختيارية)
    // ----------------------------------------------------------
    // المحادثة متاحة للجميع. جلسة Google إن وُجدت تربط الحصة بالحساب
    // بدل الجهاز؛ وانتهاؤها لا يمنع السؤال بل يعود للسياق المحلي.
    function applyAuth(snapshot) {
      var wasSignedIn = state.signedIn;
      var isResolved = Boolean(snapshot && snapshot.resolved);

      state.authResolved = isResolved;
      state.signedIn = Boolean(snapshot && snapshot.signedIn);

      if (!isResolved) return;

      if (!wasSignedIn && settings.focus) {
        window.setTimeout(function () {
          if (!els.input.value) focus();
        }, 80);
      }

      if (els.quota) els.quota.classList.add("is-loading");
      refreshQuota();

      // عند تسجيل الخروج نمسح محادثة التبويب حتى لا تظهر لحساب آخر.
      if (wasSignedIn && !state.signedIn) {
        if (state.controller) state.controller.abort();
        state.controller = null;
        state.turn += 1;
        setStreaming(false);
        newChat();
      }
    }

    // ----------------------------------------------------------
    // الحصة اليومية
    // ----------------------------------------------------------
    function applyQuotaState() {
      var exhausted = Boolean(state.quotaExhausted);

      els.input.disabled = exhausted;
      updateSendState();

      if (els.quota) {
        els.quota.title = exhausted
          ? "انتهت الحصة اليومية؛ تتجدد غدًا بتوقيت مسقط. يمكنك رفع الحد بقسيمة من الإعدادات."
          : "";
      }
    }

    // زر الإرسال يبقى معطّلاً ما دام الحقل فارغاً، أو أثناء البث،
    // أو عند نفاد الحصة، حتى لا يبدو قابلاً للنقر بلا نتيجة.
    function updateSendState() {
      if (!els.send) return;
      var empty = !String(els.input.value || "").trim();
      els.send.disabled =
        empty || Boolean(state.quotaExhausted) || Boolean(state.streaming);
    }

    function setQuota(quota) {
      if (!quota || typeof quota !== "object") return;

      var remaining = Number(quota.remaining);
      var limit = Number(quota.limit);
      if (!isFinite(remaining) || !isFinite(limit)) return;

      state.quota = quota;
      state.quotaExhausted = remaining <= 0;

      // تُشارَك الحصة مع سكربت الإعدادات ليظهر «مشترك» بلا طلب إضافي.
      window.IBNAFARIS_QUOTA = quota;

      var ratio = limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;

      if (els.quotaValue) {
        els.quotaValue.style.strokeDashoffset = String(100 - ratio * 100);
      }

      if (els.quotaCount) {
        els.quotaCount.textContent = String(Math.max(0, remaining));
      }

      if (els.quota) {
        els.quota.classList.remove("is-loading", "is-unavailable");
        els.quota.classList.toggle("is-empty", remaining <= 0);
        els.quota.setAttribute(
          "aria-label",
          remaining > 0
            ? "الحصة اليومية المتبقية: " + remaining + " من " + limit
            : "انتهت الحصة اليومية. تتجدد غدًا بتوقيت مسقط. استخدم قسيمة من الإعدادات لرفع الحد."
        );
      }

      applyQuotaState();
    }

    function quotaUnavailable() {
      if (els.quota) {
        els.quota.classList.remove("is-loading");
        els.quota.classList.add("is-unavailable");
        els.quota.setAttribute("aria-label", "تعذّر جلب الحصة اليومية");
        els.quota.title = "تعذّر جلب الحصة اليومية";
      }

      if (els.quotaValue) {
        els.quotaValue.style.strokeDashoffset = "100";
      }

      if (els.quotaCount) els.quotaCount.textContent = "?";
    }

    // تُرسل جلسة المستخدم إن وُجدت فقط؛ الحصة تعمل بلا دخول أيضاً.
    function authHeaders(extra) {
      var headers = extra || {};
      var token = authToken();
      if (token) headers.Authorization = "Bearer " + token;
      return headers;
    }

    // نجلب الحصة عند فتح المحادثة حتى لا تظهر الدائرة ممتلئة افتراضيًا.
    function refreshQuota() {
      if (!ENDPOINT || !ANON_KEY) return;

      fetch(ENDPOINT, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          // مفتاح النشر يُرسل في apikey فقط؛ رمز جلسة المستخدم في Authorization.
          apikey: ANON_KEY,
        }),
        body: JSON.stringify({ action: "quota" }),
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (data) {
          if (data && data.quota) setQuota(data.quota);
          else quotaUnavailable();
        })
        .catch(function () {
          quotaUnavailable();
        });
    }

    // ----------------------------------------------------------
    // التمرير والكتابة
    // ----------------------------------------------------------
    function nearBottom() {
      return (
        els.main.scrollHeight - els.main.scrollTop - els.main.clientHeight < 80
      );
    }

    // زر «العودة إلى آخر الرد» يظهر حين يبتعد القارئ عن نهاية المحادثة.
    function syncJump() {
      if (!els.jump) return;
      var away =
        els.main.scrollHeight - els.main.scrollTop - els.main.clientHeight > 160;
      els.jump.classList.toggle("is-visible", away);
      els.jump.tabIndex = away ? 0 : -1;
    }

    if (els.jump) {
      els.jump.addEventListener("click", function () {
        scrollToBottom(true);
        syncJump();
      });
    }

    els.main.addEventListener(
      "scroll",
      function () {
        state.stick = nearBottom();
        syncJump();
      },
      { passive: true }
    );

    function scrollToBottom(force) {
      if (force) state.stick = true;
      if (state.stick) {
        els.main.scrollTop = els.main.scrollHeight;
      }
      syncJump();
    }

    function autoGrow() {
      els.input.style.height = "auto";

      var contentHeight = els.input.scrollHeight || 40;
      var maxHeight = 168;

      els.input.style.height = Math.min(contentHeight, maxHeight) + "px";
      els.input.style.overflowY =
        contentHeight > maxHeight ? "auto" : "hidden";
    }

    function saveDraft() {
      try {
        var value = els.input.value;
        if (value.trim()) sessionStorage.setItem(DRAFT_KEY, value);
        else sessionStorage.removeItem(DRAFT_KEY);
      } catch (error) {
        // التخزين قد يكون معطلاً.
      }
    }

    function restoreDraft() {
      try {
        var value = sessionStorage.getItem(DRAFT_KEY);
        if (value) {
          els.input.value = value;
          autoGrow();
        }
      } catch (error) {
        // التخزين قد يكون معطلاً.
      }
    }

    // ----------------------------------------------------------
    // حفظ المحادثة الأخيرة واستعادتها
    // ----------------------------------------------------------
    function validSavedMessage(item) {
      return (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0
      );
    }

    function savedSources(value) {
      if (!Array.isArray(value)) return [];
      return value
        .slice(0, 8)
        .map(function (source) {
          return {
            kind: sourceText(source && source.kind, 20),
            title: sourceText(source && source.title, 180),
            detail: sourceText(source && source.detail, 160),
            url: safeSourceUrl(source && source.url),
          };
        })
        .filter(function (source) {
          return source.title;
        });
    }

    function readSavedHistory() {
      try {
        var raw = sessionStorage.getItem(HISTORY_KEY);
        if (!raw) return [];

        var data = JSON.parse(raw);
        if (
          !data ||
          data.version !== HISTORY_VERSION ||
          !Array.isArray(data.messages)
        ) {
          return [];
        }

        if (
          typeof data.savedAt === "number" &&
          Date.now() - data.savedAt > HISTORY_MAX_AGE_MS
        ) {
          sessionStorage.removeItem(HISTORY_KEY);
          return [];
        }

        return data.messages
          .filter(validSavedMessage)
          .map(function (message) {
            return {
              role: message.role,
              content: message.content,
              sources: savedSources(message.sources),
              grounding: sourceText(message.grounding, 20),
            };
          });
      } catch (error) {
        return [];
      }
    }

    function writeSavedHistory() {
      if (state.saveTimer) {
        window.clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }

      try {
        var messages = state.messages
          .filter(function (message) {
            return cleanAnswer(message.content);
          })
          .map(function (message) {
            return {
              role: message.role,
              content: cleanAnswer(message.content),
              sources: savedSources(message.sources),
              grounding: sourceText(message.grounding, 20),
            };
          });

        if (!messages.length) {
          sessionStorage.removeItem(HISTORY_KEY);
          return;
        }

        var totalChars = messages.reduce(function (sum, message) {
          return sum + message.content.length;
        }, 0);

        // نحذف الأقدم أولًا، ونبقي رسالة المستخدم الأخيرة على الأقل.
        while (messages.length > 2 && totalChars > HISTORY_MAX_CHARS) {
          var removed = messages.shift();
          totalChars -= removed ? removed.content.length : 0;
        }

        while (messages.length > 1 && messages[0].role === "assistant") {
          totalChars -= messages[0].content.length;
          messages.shift();
        }

        sessionStorage.setItem(
          HISTORY_KEY,
          JSON.stringify({
            version: HISTORY_VERSION,
            savedAt: Date.now(),
            messages: messages,
          })
        );
      } catch (error) {
        // التخزين قد يكون ممتلئاً أو معطلاً.
      }
    }

    function scheduleHistorySave() {
      if (state.saveTimer) window.clearTimeout(state.saveTimer);
      state.saveTimer = window.setTimeout(writeSavedHistory, HISTORY_SAVE_DELAY);
    }

    function clearSavedHistory() {
      if (state.saveTimer) {
        window.clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }

      try {
        sessionStorage.removeItem(HISTORY_KEY);
      } catch (error) {
        // التخزين قد يكون معطلاً.
      }
    }

    function restoreHistory() {
      var saved = readSavedHistory();
      if (!saved.length) return false;

      state.messages = [];
      state.turn = 0;
      els.messages.innerHTML = "";

      saved.forEach(function (item) {
        var message = createMessage(item.role, item.content);
        message.sources = item.sources || [];
        message.grounding = item.grounding || "";
        renderSources(message);

        if (item.role === "assistant") {
          message.el.classList.remove("is-streaming");
          addCopyButton(message);
        }
      });

      if (els.empty) els.empty.hidden = true;

      state.stick = true;
      window.requestAnimationFrame(function () {
        scrollToBottom(true);
      });

      return true;
    }

    function flushHistory() {
      writeSavedHistory();
    }

    window.addEventListener("pagehide", flushHistory);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushHistory();
    });

    els.input.addEventListener("input", function () {
      autoGrow();
      saveDraft();
      updateSendState();
    });

    els.input.addEventListener("keydown", function (event) {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        send(els.input.value);
      }
    });

    els.form.addEventListener("submit", function (event) {
      event.preventDefault();
      send(els.input.value);
    });

    Array.prototype.forEach.call(
      root.querySelectorAll("[data-if-suggest]"),
      function (button) {
        button.addEventListener("click", function () {
          if (state.streaming) return;
          send(button.getAttribute("data-if-suggest") || "");
        });
      }
    );

    if (els.stop) {
      els.stop.addEventListener("click", function () {
        if (state.controller) state.controller.abort();
      });
    }

    // ----------------------------------------------------------
    // تأكيد المحادثة الجديدة (بديل window.confirm)
    // ----------------------------------------------------------
    var confirmOpen = false;

    function openConfirm() {
      if (!els.confirm) return;

      confirmOpen = true;
      els.confirm.hidden = false;

      if (els.jump) els.jump.classList.remove("is-visible");

      window.requestAnimationFrame(function () {
        if (els.confirmCancel) {
          try {
            els.confirmCancel.focus({ preventScroll: true });
          } catch (error) {
            els.confirmCancel.focus();
          }
        }
      });
    }

    function closeConfirm(restoreFocus) {
      if (!els.confirm || !confirmOpen) return;

      confirmOpen = false;
      els.confirm.hidden = true;
      syncJump();

      if (restoreFocus && els.newChat) {
        try {
          els.newChat.focus({ preventScroll: true });
        } catch (error) {
          els.newChat.focus();
        }
      }
    }

    if (els.confirmCancel) {
      els.confirmCancel.addEventListener("click", function () {
        closeConfirm(true);
      });
    }

    if (els.confirmOk) {
      els.confirmOk.addEventListener("click", function () {
        closeConfirm(false);
        newChat();
      });
    }

    // Escape يغلق التأكيد وحده ولا يغلق اللوحة العائمة.
    document.addEventListener(
      "keydown",
      function (event) {
        if (!confirmOpen) return;
        if (event.key !== "Escape" && event.key !== "Esc") return;

        event.preventDefault();
        event.stopPropagation();
        closeConfirm(true);
      },
      true
    );

    root.addEventListener("click", function (event) {
      if (!confirmOpen) return;

      var target = elementFromTarget(event.target);
      if (target && target.closest && target.closest("#if-new")) return;
      if (target && target.closest && target.closest(".if-confirm")) return;

      closeConfirm(false);
    });

    function elementFromTarget(target) {
      if (!target) return null;
      if (target.nodeType === 1) return target;
      return target.parentElement || null;
    }

    if (els.newChat) {
      els.newChat.addEventListener("click", function () {
        if (state.streaming) return;

        if (state.messages.length > 0) {
          if (els.confirm) openConfirm();
          else if (window.confirm("سيتم حذف المحادثة الحالية. هل تريد المتابعة؟")) {
            newChat();
          }
          return;
        }

        newChat();
      });
    }

    function setStreaming(value) {
      state.streaming = value;
      if (els.stop) els.stop.hidden = !value;
      if (els.send) els.send.hidden = value;
      updateSendState();
      els.messages.setAttribute("aria-busy", value ? "true" : "false");

      if (els.newChat) {
        els.newChat.classList.toggle("is-disabled", value);
        els.newChat.setAttribute("aria-disabled", value ? "true" : "false");
      }

      // تُستخدم في اللوحة العائمة لإظهار أيقونة رسالة على زر ابن فارس
      // عندما يطوي المستخدم المحادثة والرد ما زال قيد التفكير أو البث.
      try {
        document.dispatchEvent(
          new CustomEvent("ibnfaris:streaming", {
            detail: { streaming: value },
          })
        );
      } catch (error) {
        // CustomEvent غير مدعوم في متصفحات قديمة جدًا.
      }
    }

    // ----------------------------------------------------------
    // بناء الرسائل
    // ----------------------------------------------------------
    function makeTyping() {
      var typing = document.createElement("span");
      typing.className = "if-typing";
      typing.setAttribute("role", "status");
      typing.setAttribute("aria-label", "جارٍ التفكير");
      for (var index = 0; index < 3; index += 1) {
        typing.appendChild(document.createElement("span"));
      }
      return typing;
    }

    function makeStatus(text) {
      var status = document.createElement("span");
      status.className = "if-status";
      status.setAttribute("role", "status");
      status.textContent = text;
      return status;
    }

    // ----------------------------------------------------------
    // أوامر أدوات روافد داخل الرد
    // ----------------------------------------------------------
    // يصدر ابن فارس أمراً واحداً أو أكثر في نهاية الرد على هيئة كتلة
    // سياجية بلغة ibnfaris-tool، ثم يعرض الجسر بطاقة أداة جاهزة.
    var TOOL_BLOCK =
      /```(?:ibnfaris-tool|ibn-faris-tool|tool-json)[ \t]*(?:\r?\n)?([\s\S]*?)```/gi;
    var TOOL_BLOCK_OPEN =
      /```(?:ibnfaris-tool|ibn-faris-tool|tool-json)[\s\S]*$/i;

    function parseToolActions(content) {
      var raw = String(content || "");
      var actions = [];
      var max =
        window.IbnFarisTools && window.IbnFarisTools.maxActions
          ? window.IbnFarisTools.maxActions
          : 3;
      var match;

      TOOL_BLOCK.lastIndex = 0;
      while ((match = TOOL_BLOCK.exec(raw)) !== null && actions.length < max) {
        var body = String(match[1] || "").trim();
        if (!body) continue;

        var parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (error) {
          var json = body.match(/\{[\s\S]*\}/);
          if (json) {
            try {
              parsed = JSON.parse(json[0]);
            } catch (nestedError) {
              parsed = null;
            }
          }
        }

        if (parsed) actions.push(parsed);
      }

      return actions;
    }

    function cleanAnswer(content) {
      var text = String(content || "");
      TOOL_BLOCK.lastIndex = 0;
      text = text.replace(TOOL_BLOCK, "");
      text = text.replace(TOOL_BLOCK_OPEN, "");
      return text.replace(/\n{3,}/g, "\n\n").trim();
    }

    function renderToolCards(message) {
      var host = message.toolsEl;
      if (!host) return;

      host.innerHTML = "";

      if (!window.IbnFarisTools || !window.IbnFarisTools.createCard) return;

      var actions = parseToolActions(message.content);
      actions.forEach(function (action) {
        var card = window.IbnFarisTools.createCard(action);
        if (card) host.appendChild(card);
      });
    }

    var SOURCE_LABELS = {
      book: "كتاب",
      rawafid: "محتوى روافد",
      web: "الويب",
      page: "سياق الصفحة",
    };

    function sourceText(value, max) {
      return String(value == null ? "" : value)
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/[<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max || 180);
    }

    function safeSourceUrl(value) {
      try {
        var url = new URL(String(value || ""));
        return url.protocol === "http:" || url.protocol === "https:"
          ? url.toString()
          : "";
      } catch (error) {
        return "";
      }
    }

    function renderSources(message) {
      var host = message.sourcesEl;
      if (!host) return;

      host.innerHTML = "";
      if (message.role !== "assistant") return;

      var sources = Array.isArray(message.sources) ? message.sources : [];
      var grounding = String(message.grounding || "");

      if (sources.length === 0) {
        if (grounding === "model") {
          var note = document.createElement("p");
          note.className = "if-source-note";
          note.textContent = "إجابة من المعرفة العامة دون مصدر مسترجع.";
          host.appendChild(note);
        } else if (grounding === "page") {
          var pageNote = document.createElement("p");
          pageNote.className = "if-source-note";
          pageNote.textContent = "استنادًا إلى بيانات الصفحة الحالية.";
          host.appendChild(pageNote);
        }
        return;
      }

      var details = document.createElement("details");
      details.className = "if-sources";

      var summary = document.createElement("summary");
      summary.textContent = "المصادر (" + sources.length + ")";
      details.appendChild(summary);

      var list = document.createElement("ul");
      sources.slice(0, 8).forEach(function (source) {
        if (!source || typeof source !== "object") return;

        var title = sourceText(source.title, 180);
        if (!title) return;

        var item = document.createElement("li");
        var kind = SOURCE_LABELS[source.kind] || "مصدر";
        var label = document.createElement("span");
        label.className = "if-source-kind";
        label.textContent = kind;
        item.appendChild(label);

        var titleEl = document.createElement("span");
        titleEl.className = "if-source-title";
        titleEl.textContent = title;
        item.appendChild(titleEl);

        var detail = sourceText(source.detail, 160);
        if (detail) {
          var detailEl = document.createElement("span");
          detailEl.className = "if-source-detail";
          detailEl.textContent = detail;
          item.appendChild(detailEl);
        }

        var url = safeSourceUrl(source.url);
        if (url) {
          var link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "فتح";
          item.appendChild(link);
        }

        list.appendChild(item);
      });

      details.appendChild(list);
      host.appendChild(details);
    }

    function appendCaret(container) {
      var caret = document.createElement("span");
      caret.className = "if-caret";
      caret.setAttribute("aria-hidden", "true");

      var last = container.lastElementChild;
      if (last && (last.tagName === "P" || last.tagName === "LI")) {
        last.appendChild(caret);
      } else {
        container.appendChild(caret);
      }
    }

    function createMessage(role, content) {
      var article = document.createElement("article");
      article.className = "if-msg if-msg-" + role;

      var body = document.createElement("div");
      body.className = "if-msg-body";

      if (role === "assistant") {
        var label = document.createElement("div");
        label.className = "if-answer-label";
        label.textContent = "الإجابة";
        body.appendChild(label);
      }

      var contentEl = document.createElement("div");
      contentEl.className = "if-md";
      body.appendChild(contentEl);

      var sourcesEl = document.createElement("div");
      sourcesEl.className = "if-sources-host";
      body.appendChild(sourcesEl);

      var toolsEl = document.createElement("div");
      toolsEl.className = "if-tool-cards";
      body.appendChild(toolsEl);

      var actions = document.createElement("div");
      actions.className = "if-msg-actions";
      actions.hidden = true;
      body.appendChild(actions);

      article.appendChild(body);
      els.messages.appendChild(article);

      var message = {
        role: role,
        content: content,
        el: article,
        contentEl: contentEl,
        sourcesEl: sourcesEl,
        sources: [],
        grounding: "",
        toolsEl: toolsEl,
        actionsEl: actions,
        turn: state.turn,
      };

      state.messages.push(message);
      renderMessage(message);
      return message;
    }

    function renderMessage(message) {
      var el = message.contentEl;
      if (!el) return;

      var displayContent = cleanAnswer(message.content);

      el.innerHTML = "";
      renderSources(message);

      if (
        message.role === "assistant" &&
        !displayContent &&
        state.streaming
      ) {
        el.appendChild(
          message.status ? makeStatus(message.status) : makeTyping(),
        );
        return;
      }

      if (!displayContent) {
        if (message.role === "assistant") renderToolCards(message);
        else if (message.toolsEl) message.toolsEl.innerHTML = "";
        return;
      }

      el.appendChild(renderMarkdown(displayContent));

      if (message.role === "assistant") {
        renderToolCards(message);
      }

      if (
        message.role === "assistant" &&
        state.streaming &&
        message === state.messages[state.messages.length - 1]
      ) {
        appendCaret(el);
      }
    }

    function scheduleRender(message) {
      if (state.renderTimer) return;

      // أثناء البث نعيد رسم Markdown بمعدل محدود (4 مرات/ثانية) بدل كل إطار،
      // ثم نرسم رسمًا نهائيًا فورًا عند اكتمال الرد. هذا يقلل التقطيع
      // ويحافظ على تحديد النص أثناء القراءة.
      var elapsed = Date.now() - state.lastRenderAt;
      var delay = elapsed >= 250 ? 0 : 250 - elapsed;

      state.renderTimer = window.setTimeout(function () {
        state.renderTimer = null;
        state.lastRenderAt = Date.now();
        renderMessage(message);
        scrollToBottom(false);
      }, delay);
    }

    function cancelScheduledRender() {
      if (!state.renderTimer) return;
      window.clearTimeout(state.renderTimer);
      state.renderTimer = null;
    }

    // ----------------------------------------------------------
    // Markdown + شعر عمودي
    // ----------------------------------------------------------
    var POETRY_FENCE_START = /^```(?:poetry|poem|verse|شعر|الشعر)\s*$/i;
    var FENCE_START = /^```/;
    var FENCE_END = /^```\s*$/;
    var VERSE_SEPARATOR = /\s*(?:\*{1,3}|—|–|\||\/\/)\s*/;
    var AUTO_SEPARATOR = /\s\*{1,3}\s/;
    var STRONG_SEPARATOR = /\*{3,}/;

    function cleanHemistich(value) {
      return String(value || "")
        .replace(/[*`_~]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function toVerse(sadr, ajz) {
      var cleanSadr = cleanHemistich(sadr);
      var cleanAjz = cleanHemistich(ajz);
      if (!cleanSadr || !cleanAjz) return null;
      return { sadr: cleanSadr, ajz: cleanAjz };
    }

    function parseVerseLine(line, separator) {
      var match = separator.exec(line);
      if (!match) return null;
      return toVerse(
        line.slice(0, match.index),
        line.slice(match.index + match[0].length)
      );
    }

    function isAutoVerseLine(line) {
      var trimmed = line.trim();
      if (!trimmed) return false;
      if (/^(?:[-*+>]|\d+[.)])\s/.test(trimmed)) return false;
      if (/^#{1,6}\s/.test(trimmed)) return false;
      if (
        trimmed.charAt(0) === "|" ||
        trimmed.charAt(trimmed.length - 1) === "|"
      ) {
        return false;
      }
      return parseVerseLine(trimmed, AUTO_SEPARATOR) !== null;
    }

    function parseFencedVerses(lines) {
      var verses = lines
        .map(function (line) {
          return parseVerseLine(line.trim(), VERSE_SEPARATOR);
        })
        .filter(function (verse) {
          return verse !== null;
        });

      if (verses.length > 0) return verses;

      var nonEmpty = lines
        .map(function (line) {
          return line.trim();
        })
        .filter(function (line) {
          return line.length > 0;
        });

      if (nonEmpty.length < 2 || nonEmpty.length % 2 !== 0) return [];

      var paired = [];
      for (var index = 0; index < nonEmpty.length; index += 2) {
        var verse = toVerse(nonEmpty[index], nonEmpty[index + 1]);
        if (verse) paired.push(verse);
      }
      return paired;
    }

    function pushMarkdown(segments, lines) {
      if (lines.length === 0) return;
      var content = lines.join("\n");
      if (!content.trim()) return;
      segments.push({ kind: "markdown", content: content });
    }

    // الأبيات المتتالية التي لا يفصلها شرح تُجمع في جدول شعري واحد.
    function pushPoetry(segments, verses) {
      if (!verses || verses.length === 0) return;

      var previous = segments[segments.length - 1];
      if (previous && previous.kind === "poetry") {
        previous.verses = previous.verses.concat(verses);
        return;
      }

      segments.push({ kind: "poetry", verses: verses });
    }

    function parsePoetrySegments(content) {
      var lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
      var segments = [];
      var markdownLines = [];
      var index = 0;

      while (index < lines.length) {
        var line = lines[index];
        var trimmed = line.trim();

        if (POETRY_FENCE_START.test(trimmed)) {
          pushMarkdown(segments, markdownLines);
          markdownLines = [];

          var verseLines = [];
          index += 1;
          while (index < lines.length && !FENCE_END.test(lines[index].trim())) {
            verseLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;

          var verses = parseFencedVerses(verseLines);
          if (verses.length > 0) {
            pushPoetry(segments, verses);
          } else {
            markdownLines.push("```");
            markdownLines = markdownLines.concat(verseLines);
            markdownLines.push("```");
          }
          continue;
        }

        if (FENCE_START.test(trimmed)) {
          markdownLines.push(line);
          index += 1;
          while (index < lines.length) {
            markdownLines.push(lines[index]);
            var closed = FENCE_END.test(lines[index].trim());
            index += 1;
            if (closed) break;
          }
          continue;
        }

        if (isAutoVerseLine(line)) {
          var autoLines = [line.trim()];
          var nextIndex = index + 1;
          while (nextIndex < lines.length && isAutoVerseLine(lines[nextIndex])) {
            autoLines.push(lines[nextIndex].trim());
            nextIndex += 1;
          }

          var strong = autoLines.some(function (verseLine) {
            return STRONG_SEPARATOR.test(verseLine);
          });

          if (autoLines.length >= 2 || (strong && autoLines.length === 1)) {
            pushMarkdown(segments, markdownLines);
            markdownLines = [];
            pushPoetry(
              segments,
              autoLines
                .map(function (verseLine) {
                  return parseVerseLine(verseLine, AUTO_SEPARATOR);
                })
                .filter(function (verse) {
                  return verse !== null;
                })
            );
            index = nextIndex;
            continue;
          }
        }

        markdownLines.push(line);
        index += 1;
      }

      pushMarkdown(segments, markdownLines);
      return segments;
    }

    function buildPoetry(verses) {
      var figure = document.createElement("figure");
      figure.className = "if-poetry";
      figure.setAttribute("dir", "rtl");

      var caption = document.createElement("figcaption");
      caption.textContent = "شعر عمودي";
      figure.appendChild(caption);

      var body = document.createElement("div");
      body.className = "if-poetry-body";

      verses.forEach(function (verse) {
        var row = document.createElement("div");
        row.className = "if-verse";

        var sadr = document.createElement("span");
        sadr.textContent = verse.sadr;
        var ajz = document.createElement("span");
        ajz.textContent = verse.ajz;

        row.appendChild(sadr);
        row.appendChild(ajz);
        body.appendChild(row);
      });

      figure.appendChild(body);
      return figure;
    }

    function buildMarkdown(content) {
      var container = document.createElement("div");

      if (!window.marked || !window.DOMPurify) {
        container.className = "if-plain";
        container.textContent = content;
        return container;
      }

      var html = "";
      try {
        html = window.marked.parse(content, { gfm: true, breaks: true });
      } catch (error) {
        container.className = "if-plain";
        container.textContent = content;
        return container;
      }

      container.innerHTML = window.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ["target", "rel"],
        // نمنع الصور والوسائط البعيدة والأنماط المضمّنة: قد تستخدم لتتبع
        // المستخدم أو لإعادة تنسيق الصفحة، ولا يحتاجها نص الإجابة.
        FORBID_TAGS: [
          "style",
          "form",
          "input",
          "button",
          "iframe",
          "img",
          "video",
          "audio",
        ],
        FORBID_ATTR: ["style"],
      });

      container.querySelectorAll("a").forEach(function (link) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });

      decorateTables(container);

      return container;
    }

    // يضيف عنوان العمود إلى كل خلية ليعرضها التصميم المتجاوب على الجوال.
    function labelTableCells(table) {
      var headerCells = table.querySelectorAll("thead th");
      if (headerCells.length === 0) {
        var firstRow = table.querySelector("tr");
        if (!firstRow) return;
        headerCells = firstRow.querySelectorAll("th");
      }
      if (headerCells.length === 0) return;

      var labels = Array.prototype.map.call(headerCells, function (cell) {
        return (cell.textContent || "").replace(/\s+/g, " ").trim();
      });

      var rows = table.querySelectorAll("tbody tr");
      if (rows.length === 0) rows = table.querySelectorAll("tr");

      Array.prototype.forEach.call(rows, function (row) {
        if (row.querySelector("th")) return;

        Array.prototype.forEach.call(row.children, function (cell, index) {
          if (cell.tagName !== "TD") return;
          var label = labels[index];
          if (label) cell.setAttribute("data-label", label);
        });
      });
    }

    function decorateTables(container) {
      var tables = Array.prototype.slice.call(
        container.querySelectorAll("table")
      );

      var COPY_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      var CHECK_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"></path></svg>';

      tables.forEach(function (table) {
        if (!table.parentNode) return;

        labelTableCells(table);

        var figure = document.createElement("figure");
        figure.className = "if-table";
        figure.setAttribute("dir", "rtl");
        figure.setAttribute("aria-label", "جدول");

        var caption = document.createElement("figcaption");
        caption.className = "if-table-caption";

        var label = document.createElement("span");
        label.className = "if-table-label";
        label.textContent = "جدول";

        var button = document.createElement("button");
        button.type = "button";
        button.className = "if-table-copy";
        button.setAttribute("aria-label", "نسخ الجدول");
        button.innerHTML = COPY_ICON + "<span>نسخ الجدول</span>";

        var copyTimer = null;
        button.addEventListener("click", function () {
          var text = (table.innerText || "").trim();
          if (!text) return;

          copyText(text)
            .then(function () {
              button.innerHTML = CHECK_ICON + "<span>تم النسخ</span>";
              button.setAttribute("aria-label", "تم نسخ الجدول");
              if (copyTimer) window.clearTimeout(copyTimer);
              copyTimer = window.setTimeout(function () {
                button.innerHTML = COPY_ICON + "<span>نسخ الجدول</span>";
                button.setAttribute("aria-label", "نسخ الجدول");
              }, 1800);
            })
            .catch(function () {
              // نُبقي الزر كما هو إن تعذّر النسخ.
            });
        });

        caption.appendChild(label);
        caption.appendChild(button);

        var scroll = document.createElement("div");
        scroll.className = "if-table-scroll";

        table.parentNode.insertBefore(figure, table);
        scroll.appendChild(table);
        figure.appendChild(caption);
        figure.appendChild(scroll);
      });
    }

    function renderMarkdown(content) {
      var fragment = document.createDocumentFragment();
      var segments = parsePoetrySegments(content);

      segments.forEach(function (segment) {
        if (segment.kind === "poetry") {
          fragment.appendChild(buildPoetry(segment.verses));
          return;
        }

        if (segment.content.trim()) {
          fragment.appendChild(buildMarkdown(segment.content));
        }
      });

      return fragment;
    }

    // ----------------------------------------------------------
    // النسخ
    // ----------------------------------------------------------
    function legacyCopy(text) {
      return new Promise(function (resolve, reject) {
        var textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        root.appendChild(textarea);
        textarea.select();

        var copied = false;
        try {
          copied = document.execCommand("copy");
        } catch (error) {
          copied = false;
        }

        if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
        if (copied) resolve();
        else reject(new Error("copy_failed"));
      });
    }

    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(function () {
          return legacyCopy(text);
        });
      }

      return legacyCopy(text);
    }

    function addCopyButton(message) {
      if (!message.actionsEl || message.actionsEl.querySelector(".if-copy")) {
        return;
      }

      var button = document.createElement("button");
      button.type = "button";
      button.className = "if-copy";
      button.setAttribute("aria-label", "نسخ إجابة ابن فارس");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>نسخ</span>';

      var label = button.querySelector("span");

      button.addEventListener("click", function () {
        copyText(cleanAnswer(message.content))
          .then(function () {
            button.classList.add("is-copied");
            button.setAttribute("aria-label", "تم نسخ إجابة ابن فارس");
            if (label) label.textContent = "تم النسخ";
            window.setTimeout(function () {
              button.classList.remove("is-copied");
              button.setAttribute("aria-label", "نسخ إجابة ابن فارس");
              if (label) label.textContent = "نسخ";
            }, 1800);
          })
          .catch(function () {
            button.classList.remove("is-copied");
          });
      });

      message.actionsEl.appendChild(button);
      message.actionsEl.hidden = false;
    }

    // ----------------------------------------------------------
    // إنهاء الدور
    // ----------------------------------------------------------
    function removeMessage(message) {
      if (!message) return;
      if (message.el && message.el.parentNode) message.el.remove();
      var index = state.messages.indexOf(message);
      if (index !== -1) state.messages.splice(index, 1);
    }

    function finishTurn(message, errorText) {
      if (!message || message.turn !== state.turn) return;

      cancelScheduledRender();
      setStreaming(false);
      renderMessage(message);

      var actions = parseToolActions(message.content);
      var hasText = Boolean(cleanAnswer(message.content));
      var hasActions = actions.length > 0;

      if (!hasText && !hasActions) {
        var assistantIndex = state.messages.indexOf(message);
        var previous =
          assistantIndex > 0 ? state.messages[assistantIndex - 1] : null;

        removeMessage(message);

        // إن كان الخطأ قبل أي إجابة، نزيل أيضًا سؤال المستخدم المعلّق
        // حتى لا يظهر سؤال بلا جواب ولا يتكرر عند إعادة الإرسال.
        if (errorText && previous && previous.role === "user") {
          removeMessage(previous);
        }

        if (state.messages.length === 0 && els.empty) {
          els.empty.hidden = false;
        }
      } else {
        message.el.classList.remove("is-streaming");
        addCopyButton(message);
      }

      writeSavedHistory();

      if (errorText) {
        showAlert(errorText);
        announce(errorText);
      } else {
        var answerText = naturalText(cleanAnswer(message.content));
        announce(
          answerText && answerText.length <= 400
            ? answerText
            : "تمت الإجابة."
        );
      }

      // لا نطبّق أوامر الأدوات تلقائياً بعد الرد: قد تستبدل بيانات المستخدم
      // في الحاسبة أو التوثيق أو العجلة. تبقى البطاقة ظاهرة، والتطبيق بضغطة
      // صريحة من المستخدم فقط (مع تأكيد للأدوات التي تستبدل الحالة).
    }

    // ----------------------------------------------------------
    // الإرسال والبث
    // ----------------------------------------------------------
    function friendlyError(error) {
      var message =
        error && typeof error.message === "string" ? error.message.trim() : "";

      if (
        (error && error.name === "TypeError") ||
        /failed to fetch|networkerror|load failed/i.test(message)
      ) {
        return "تعذّر الوصول إلى خدمة ابن فارس. تحقّق من اتصالك بالشبكة وحاول مجددًا.";
      }

      // لا نعرض تفاصيل تشغيلية داخلية (DeepSeek/Supabase/أكواد الخادم).
      if (/deepseek|supabase|service_role|ibn-faris-chat|\(\s*5\d\d\s*\)/i.test(message)) {
        return "تعذّر إكمال الطلب حاليًا. حاول بعد قليل.";
      }

      return message || "تعذّر إرسال الطلب. تحقّق من الاتصال وحاول مجدداً.";
    }

    function send(raw) {
      var text = String(raw || "").trim();
      if (!text || state.streaming || !ENDPOINT || !ANON_KEY) return;

      if (state.quotaExhausted) {
        showAlert(
          "انتهت حصتك اليومية. تتجدد غدًا بتوقيت مسقط، أو ارفع حدّك بقسيمة من الإعدادات."
        );
        return;
      }

      hideAlert();

      if (state.messages.length === 0 && els.empty) {
        els.empty.hidden = true;
      }

      state.turn += 1;
      var turn = state.turn;

      createMessage("user", text);
      scheduleHistorySave();

      els.input.value = "";
      autoGrow();
      saveDraft();
      updateSendState();

      setStreaming(true);
      state.stick = true;
      announce("جارٍ التفكير…");

      var assistant = createMessage("assistant", "");
      assistant.turn = turn;
      assistant.el.classList.add("is-streaming");

      scrollToBottom(true);

      var history = state.messages
        .slice(0, -1)
        .slice(-MAX_HISTORY)
        .map(function (message) {
          return { role: message.role, content: cleanAnswer(message.content) };
        })
        .filter(function (message) {
          return message.content;
        });

      var controller = new AbortController();
      state.controller = controller;

      var payload = { messages: history, capabilities: { tools: true } };
      if (window.IbnFarisPageContext && window.IbnFarisPageContext.get) {
        try {
          var pageContext = window.IbnFarisPageContext.get();
          if (pageContext) payload.context = pageContext;
        } catch (error) {
          // السياق تحسيني فقط؛ لا نمنع السؤال إذا تعذّر بناؤه.
        }
      }

      fetch(ENDPOINT, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        }),
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(function (response) {
          if (!response.ok) {
            return response
              .json()
              .catch(function () {
                return null;
              })
              .then(function (data) {
                if (data && data.quota) setQuota(data.quota);
                var message =
                  data && typeof data.error === "string"
                    ? data.error
                    : "تعذّر إرسال الطلب. حاول مرة أخرى.";
                throw new Error(message);
              });
          }

          if (!response.body) {
            throw new Error("تعذّر قراءة الرد من الخادم.");
          }

          return consume(response, assistant, controller);
        })
        .catch(function (error) {
          if (controller.signal.aborted) {
            finishTurn(assistant, null);
            return;
          }

          if (!assistant.content.trim() && !els.input.value.trim()) {
            els.input.value = text;
            autoGrow();
            saveDraft();
          }

          finishTurn(assistant, friendlyError(error));
        })
        .finally(function () {
          if (state.controller === controller) state.controller = null;
        });
    }

    async function consume(response, assistant, controller) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var gotAnswer = false;
      var streamError = null;

      function handleFrame(frame) {
        var lines = frame.split("\n");

        for (var index = 0; index < lines.length; index += 1) {
          var line = lines[index].trim();
          if (line.indexOf("data:") !== 0) continue;

          var raw = line.slice(5).trim();
          if (!raw) continue;

          var event;
          try {
            event = JSON.parse(raw);
          } catch (error) {
            continue;
          }

          if (event.type === "status" && typeof event.text === "string") {
            assistant.status = event.text;
            scheduleRender(assistant);
            continue;
          }

          if (event.type === "sources") {
            assistant.sources = Array.isArray(event.sources)
              ? event.sources
              : [];
            assistant.grounding =
              typeof event.grounding === "string" ? event.grounding : "";
            renderSources(assistant);
            continue;
          }

          if (event.type === "answer" && typeof event.text === "string") {
            gotAnswer = true;
            assistant.content += event.text;
            scheduleRender(assistant);
            scheduleHistorySave();
            continue;
          }

          if (event.type === "ungrounded" && typeof event.text === "string") {
            gotAnswer = true;
            assistant.content = event.text;
            scheduleRender(assistant);
            scheduleHistorySave();
            continue;
          }

          if (event.type === "quota") {
            setQuota(event.quota);
            continue;
          }

          if (event.type === "error" && typeof event.error === "string") {
            streamError = event.error;
          }
        }
      }

      try {
        while (true) {
          var result = await reader.read();
          if (result.done) break;

          buffer += decoder.decode(result.value, { stream: true });

          var boundary;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            var frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleFrame(frame);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) handleFrame(buffer);

        if (!gotAnswer) {
          throw new Error(streamError || "لم يكتمل الرد. حاول مرة أخرى.");
        }

        finishTurn(assistant, streamError);
      } finally {
        try {
          reader.releaseLock();
        } catch (error) {
          // القارئ مغلق مسبقاً.
        }
      }
    }

    // ----------------------------------------------------------
    // محادثة جديدة
    // ----------------------------------------------------------
    function newChat() {
      if (state.streaming) return false;

      state.turn += 1;
      if (state.controller) state.controller.abort();
      state.controller = null;
      cancelScheduledRender();

      state.messages = [];
      els.messages.innerHTML = "";
      clearSavedHistory();

      if (els.empty) els.empty.hidden = false;

      setStreaming(false);
      hideAlert();

      els.input.value = "";
      autoGrow();
      saveDraft();
      updateSendState();
      els.main.scrollTop = 0;
      syncJump();
      announce("محادثة جديدة.");
      return true;
    }

    function focus() {
      if (!els.input.disabled) {
        try {
          els.input.focus({ preventScroll: true });
        } catch (error) {
          els.input.focus();
        }
      }
    }

    // ----------------------------------------------------------
    // التهيئة
    // ----------------------------------------------------------
    function initialize() {
      // إزالة النسخة القديمة من السجل المحلي الدائم إن وُجدت.
      try {
        localStorage.removeItem(HISTORY_KEY);
      } catch (error) {
        // التخزين قد يكون معطلاً.
      }

      restoreDraft();
      restoreHistory();
      autoGrow();
      setStreaming(false);
      updateSendState();
      syncJump();

      if (!ENDPOINT || !ANON_KEY) {
        showAlert("خدمة ابن فارس غير متاحة حاليًا. حاول لاحقًا.");
        els.input.disabled = true;
        if (els.send) els.send.disabled = true;
        return;
      }

      if (els.quota) els.quota.classList.add("is-loading");

      // onChange يستدعي applyAuth فوراً بالحالة الحالية ثم عند كل تغيّر.
      // غياب سكربت الدخول لا يمنع المحادثة؛ نكتفي بجلب الحصة مباشرة.
      if (AUTH && typeof AUTH.onChange === "function") {
        state.authUnsub = AUTH.onChange(applyAuth);
      } else {
        refreshQuota();
      }

      window.setInterval(refreshQuota, 5 * 60 * 1000);

      if (
        settings.focus &&
        window.matchMedia &&
        window.matchMedia("(pointer: fine)").matches
      ) {
        window.setTimeout(function () {
          if (!els.input.value) focus();
        }, 60);
      }
    }

    initialize();

    // ترفع نافذة القسائم السقف اليومي، فتُحدَّث الحصة فوراً بعد الاستبدال.
    window.addEventListener("ibn-faris:quota-refresh", refreshQuota);

    var api = {
      root: root,
      focus: focus,
      reset: newChat,
      refreshQuota: refreshQuota,
      isStreaming: function () {
        return state.streaming;
      },
    };

    root.__ibnFarisApi = api;

    return api;
  }

  window.IbnFarisChat = { mount: mount };

  function autoMount() {
    var root = document.getElementById("if-app");
    // نسخة اللوحة العائمة تُركَّب من السكربت بعد جهوزية كل الموارد،
    // فلا نركّبها هنا حتى لا تُرسم قبل تحميل مكتبات Markdown.
    if (!root || root.closest(".if-overlay")) return;
    mount(root, { focus: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
