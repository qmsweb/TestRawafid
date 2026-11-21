/* ============================================================
   ابن فارس — واجهة المحادثة
   ============================================================
   • تتصل بدالة Supabase: functions/v1/ibn-faris-chat
   • تستقبل بثّ SSE مبسّطاً: answer / thinking / quota / error
   • تحفظ المحادثة الأخيرة محلياً (localStorage) وتستعيدها عند إعادة
     تحميل الصفحة أو الانتقال إلى صفحة أخرى، وتحتفظ بمسودة الكتابة
     في sessionStorage.
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
  var DRAFT_KEY = "ibnfaris-rawafid-draft";
  var HISTORY_KEY = "ibnfaris-rawafid-history";
  var HISTORY_VERSION = 1;
  var HISTORY_SAVE_DELAY = 300;

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
      form: q("#if-form"),
      input: q("#if-input"),
      send: q("#if-send"),
      stop: q("#if-stop"),
      alert: q("#if-alert"),
      alertText: q("#if-alert-text"),
      newChat: q("#if-new"),
      quota: q("#if-quota"),
      quotaValue: q("#if-quota-value"),
    };

    if (!els.main || !els.form || !els.input || !els.messages) return null;

    var ICON =
      root.getAttribute("data-icon") || "images/ibnfaris-icon.png";

    var state = {
      messages: [],
      streaming: false,
      controller: null,
      quota: null,
      raf: null,
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

    // ----------------------------------------------------------
    // الحصة اليومية
    // ----------------------------------------------------------
    function setQuota(quota) {
      if (!quota || typeof quota !== "object") return;

      var remaining = Number(quota.remaining);
      var limit = Number(quota.limit);
      if (!isFinite(remaining) || !isFinite(limit) || limit <= 0) return;

      state.quota = quota;

      var ratio = Math.max(0, Math.min(1, remaining / limit));

      if (els.quotaValue) {
        els.quotaValue.style.strokeDashoffset = String(100 - ratio * 100);
      }

      if (els.quota) {
        els.quota.classList.remove("is-loading");
        els.quota.classList.toggle("is-empty", remaining <= 0);
        els.quota.setAttribute(
          "aria-label",
          remaining > 0
            ? "الحصة اليومية المتبقية: " + remaining + " من " + limit
            : "انتهت الحصة اليومية"
        );
      }
    }

    // نجلب الحصة عند فتح المحادثة حتى لا تظهر الدائرة ممتلئة افتراضيًا.
    function refreshQuota() {
      if (!ENDPOINT || !ANON_KEY) return;

      fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + ANON_KEY,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ action: "quota" }),
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (data) {
          if (data && data.quota) setQuota(data.quota);
        })
        .catch(function () {
          // الدائرة تبقى محايدة إن تعذّر جلب الحصة.
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

    els.main.addEventListener(
      "scroll",
      function () {
        state.stick = nearBottom();
      },
      { passive: true }
    );

    function scrollToBottom(force) {
      if (force) state.stick = true;
      if (state.stick) {
        els.main.scrollTop = els.main.scrollHeight;
      }
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

    function readSavedHistory() {
      try {
        var raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];

        var data = JSON.parse(raw);
        if (
          !data ||
          data.version !== HISTORY_VERSION ||
          !Array.isArray(data.messages)
        ) {
          return [];
        }

        return data.messages
          .filter(validSavedMessage)
          .map(function (message) {
            return { role: message.role, content: message.content };
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
            return message.content && message.content.trim();
          })
          .map(function (message) {
            return { role: message.role, content: message.content };
          });

        if (!messages.length) {
          localStorage.removeItem(HISTORY_KEY);
          return;
        }

        localStorage.setItem(
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
        localStorage.removeItem(HISTORY_KEY);
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

    if (els.stop) {
      els.stop.addEventListener("click", function () {
        if (state.controller) state.controller.abort();
      });
    }

    if (els.newChat) {
      els.newChat.addEventListener("click", function () {
        if (state.streaming) {
          showAlert(
            "انتظر حتى ينتهي رد ابن فارس أو أوقفه أولًا قبل بدء محادثة جديدة."
          );
          return;
        }
        newChat();
      });
    }

    function setStreaming(value) {
      state.streaming = value;
      if (els.stop) els.stop.hidden = !value;
      if (els.send) els.send.hidden = value;
      els.messages.setAttribute("aria-busy", value ? "true" : "false");

      if (els.newChat) {
        els.newChat.classList.toggle("is-disabled", value);
        els.newChat.setAttribute("aria-disabled", value ? "true" : "false");
        els.newChat.title = value
          ? "لا يمكن بدء محادثة جديدة أثناء رد ابن فارس"
          : "محادثة جديدة";
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

      el.innerHTML = "";

      if (message.role === "assistant" && !message.content && state.streaming) {
        el.appendChild(
          message.status ? makeStatus(message.status) : makeTyping(),
        );
        return;
      }

      if (!message.content) return;

      el.appendChild(renderMarkdown(message.content));

      if (
        message.role === "assistant" &&
        state.streaming &&
        message === state.messages[state.messages.length - 1]
      ) {
        appendCaret(el);
      }
    }

    function scheduleRender(message) {
      if (state.raf) return;
      state.raf = window.requestAnimationFrame(function () {
        state.raf = null;
        renderMessage(message);
        scrollToBottom(false);
      });
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
      segments.push({ kind: "markdown", content: lines.join("\n") });
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
            segments.push({ kind: "poetry", verses: verses });
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
            segments.push({
              kind: "poetry",
              verses: autoLines
                .map(function (verseLine) {
                  return parseVerseLine(verseLine, AUTO_SEPARATOR);
                })
                .filter(function (verse) {
                  return verse !== null;
                }),
            });
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
      });

      container.querySelectorAll("a").forEach(function (link) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });

      decorateTables(container);

      return container;
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
        copyText(message.content)
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
    function finishTurn(message, errorText) {
      if (!message || message.turn !== state.turn) return;

      setStreaming(false);
      renderMessage(message);

      if (!message.content.trim()) {
        message.el.remove();
        var index = state.messages.indexOf(message);
        if (index !== -1) state.messages.splice(index, 1);
      } else {
        message.el.classList.remove("is-streaming");
        addCopyButton(message);
      }

      writeSavedHistory();

      if (errorText) showAlert(errorText);
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
        return "تعذّر الوصول إلى خدمة ابن فارس. تأكد من نشر دالة ibn-faris-chat على Supabase ومن اتصال الشبكة.";
      }

      return message || "تعذّر إرسال الطلب. تحقّق من الاتصال وحاول مجدداً.";
    }

    function send(raw) {
      var text = String(raw || "").trim();
      if (!text || state.streaming || !ENDPOINT || !ANON_KEY) return;

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

      setStreaming(true);
      state.stick = true;

      var assistant = createMessage("assistant", "");
      assistant.turn = turn;
      assistant.el.classList.add("is-streaming");

      scrollToBottom(true);

      var history = state.messages
        .slice(0, -1)
        .slice(-MAX_HISTORY)
        .map(function (message) {
          return { role: message.role, content: message.content };
        });

      var controller = new AbortController();
      state.controller = controller;

      var payload = { messages: history };
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
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + ANON_KEY,
          apikey: ANON_KEY,
        },
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
      if (state.streaming) {
        showAlert(
          "لا يمكن بدء محادثة جديدة أثناء رد ابن فارس. انتظر اكتمال الرد أو أوقفه أولًا."
        );
        return false;
      }

      state.turn += 1;
      if (state.controller) state.controller.abort();
      state.controller = null;

      state.messages = [];
      els.messages.innerHTML = "";
      clearSavedHistory();

      if (els.empty) els.empty.hidden = false;

      setStreaming(false);
      hideAlert();

      els.input.value = "";
      autoGrow();
      saveDraft();
      els.main.scrollTop = 0;
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
      restoreDraft();
      restoreHistory();
      autoGrow();
      setStreaming(false);

      if (!ENDPOINT || !ANON_KEY) {
        showAlert(
          "خدمة ابن فارس غير مهيّأة بعد. راجع دليل الإعداد في supabase/README.md."
        );
        els.input.disabled = true;
        if (els.send) els.send.disabled = true;
        return;
      }

      if (els.quota) els.quota.classList.add("is-loading");
      refreshQuota();

      if (settings.focus) {
        window.setTimeout(function () {
          if (!els.input.value) focus();
        }, 60);
      }
    }

    initialize();

    var api = {
      root: root,
      focus: focus,
      reset: newChat,
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
    if (!root) return;
    mount(root, { focus: !root.closest(".if-overlay") });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
