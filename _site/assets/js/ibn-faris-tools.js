/* ============================================================
   ابن فارس — جسر أدوات روافد
   ============================================================
   • يقرأ أوامر الأدوات التي يصدرها ابن فارس في نهاية الرد.
   • يعرض بطاقة أداة جاهزة داخل المحادثة (حاسبة، توثيق، عجلة، خطة).
   • يطبّق البيانات مباشرة إن كانت الأداة مفتوحة، أو يحفظها ويفتحها.
   • أداة QR غير مشمولة بقصد.
   ============================================================ */
(function () {
  "use strict";

  var PENDING_KEY = "ibnfaris-tool-pending-v1";
  var MAX_AGE_MS = 10 * 60 * 1000;
  var MAX_ACTIONS = 3;
  var MAX_GPA_COURSES = 40;
  var MAX_WHEEL_NAMES = 80;

  var script = document.currentScript;
  var BASE = (script && script.getAttribute("data-base")) || "/";
  if (BASE.charAt(BASE.length - 1) !== "/") BASE += "/";

  var TOOLS = {
    gpa: {
      name: "حاسبة المعدل",
      short: "الحاسبة",
      path: BASE + "tools/gpa",
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2.5"></rect><path d="M8 7h8"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M8 16.5h.01"></path><path d="M12 16.5h.01"></path><path d="M16 16.5h.01"></path></svg>',
    },
    tawtheeq: {
      name: "توثيق المراجع",
      short: "التوثيق",
      path: BASE + "tools/tawtheeq-tool",
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v17H6.5A2.5 2.5 0 0 0 4 22z"></path><path d="M4 5.5v14"></path><path d="M8 7.5h7"></path><path d="M8 11h5"></path></svg>',
    },
    wheel: {
      name: "العجلة الدوارة",
      short: "العجلة",
      path: BASE + "tools/wheel",
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v18"></path><path d="M3 12h18"></path><path d="m5.6 5.6 12.8 12.8"></path><path d="M18.4 5.6 5.6 18.4"></path><circle cx="12" cy="12" r="2.2"></circle></svg>',
    },
    "study-plan": {
      name: "الخطة الدراسية",
      short: "الخطة",
      path: BASE + "tools/study-plan",
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z"></path><path d="M8 7h7"></path><path d="M8 11h7"></path><path d="M8 15h4"></path></svg>',
    },
  };

  var TAWTHEEQ_TYPES = {
    book: "كتاب",
    journal: "مقال في دورية",
    thesis_pub: "رسالة منشورة",
    thesis_unpub: "رسالة غير منشورة",
    conference: "ورقة في مؤتمر",
    newspaper: "مقال في صحيفة",
  };

  var GRADE_SCALE = {
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    "C-": 1.7,
    "D+": 1.3,
    D: 1.0,
    F: 0.0,
  };

  function text(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 160);
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function currentTool() {
    var path = String(window.location.pathname || "").replace(/\/+$/, "");

    if (/\/tools\/gpa$/.test(path)) return "gpa";
    if (/\/tools\/tawtheeq-tool$/.test(path)) return "tawtheeq";
    if (/\/tools\/wheel$/.test(path)) return "wheel";
    if (/\/tools\/study-plan(?:\/|$)/.test(path)) return "study-plan";

    return null;
  }

  function normalizeGrade(value) {
    var grade = text(value, 4).toUpperCase().replace(/[–—]/g, "-");
    grade = grade.replace(/\s+/g, "");
    return GRADE_SCALE[grade] !== undefined ? grade : "";
  }

  function normalizeGpa(data) {
    if (!data || typeof data !== "object") return null;

    var courses = [];
    var rows = Array.isArray(data.courses) ? data.courses : [];
    rows.slice(0, MAX_GPA_COURSES).forEach(function (row) {
      if (!row || typeof row !== "object") return;

      var hours = number(row.hours != null ? row.hours : row.creditHours);
      var grade = normalizeGrade(row.grade);
      var name = text(row.name || row.course, 120);

      if (!name && !grade && !(hours > 0)) return;

      courses.push({
        name: name,
        hours: hours && hours > 0 ? hours : null,
        grade: grade,
      });
    });

    if (courses.length === 0) return null;

    var previousGpa = number(data.previousGpa != null ? data.previousGpa : data.prevGpa);
    var previousHours = number(
      data.previousHours != null ? data.previousHours : data.prevHours
    );

    return {
      mode: data.mode === "cumulative" ? "cumulative" : "semester",
      previousGpa:
        previousGpa != null && previousGpa >= 0 && previousGpa <= 4
          ? previousGpa
          : null,
      previousHours:
        previousHours != null && previousHours > 0 ? previousHours : null,
      courses: courses,
    };
  }

  function normalizeTawtheeq(data) {
    if (!data || typeof data !== "object") return null;

    var type = text(data.type, 30).toLowerCase();
    var typeAliases = {
      article: "journal",
      magazine: "journal",
      thesis: "thesis_unpub",
      dissertation: "thesis_unpub",
      paper: "conference",
      web: "newspaper",
      كتاب: "book",
      دورية: "journal",
      مجلة: "journal",
      رسالة: "thesis_unpub",
      أطروحة: "thesis_unpub",
      مؤتمر: "conference",
      صحيفة: "newspaper",
    };
    if (typeAliases[type]) type = typeAliases[type];
    if (!TAWTHEEQ_TYPES[type]) return null;

    // نقبل الحقول مسطّحة كما في تعليمات النموذج، أو مجمّعة داخل fields.
    var source =
      data.fields && typeof data.fields === "object" ? data.fields : data;

    var fields = {};
    [
      "authors",
      "year",
      "title",
      "sourceName",
      "volume",
      "issue",
      "pages",
      "publisher",
      "location",
      "url",
      "fullDate",
      "bracketInfo",
    ].forEach(function (key) {
      var value = text(source[key], key === "url" ? 300 : 220);
      if (value) fields[key] = value;
    });

    if (!fields.title && !fields.authors) return null;

    return {
      type: type,
      fields: fields,
      copy: Boolean(data.copy),
    };
  }

  function normalizeNames(value) {
    var list = [];

    if (Array.isArray(value)) {
      list = value.slice(0, MAX_WHEEL_NAMES);
    } else if (typeof value === "string") {
      list = value.split(/[\n،,;]+/).slice(0, MAX_WHEEL_NAMES);
    }

    return list
      .map(function (name) {
        return text(name, 60);
      })
      .filter(Boolean);
  }

  function normalizeWheel(data) {
    if (!data || typeof data !== "object") return null;

    var names = normalizeNames(data.names != null ? data.names : data.entries);
    if (names.length === 0) return null;

    return {
      names: names,
      removeWinner: Boolean(data.removeWinner),
      spin: Boolean(data.spin),
    };
  }

  function normalizeStudyPlan(data) {
    if (!data || typeof data !== "object") return null;

    var plan = text(data.plan, 12).toLowerCase();
    if (plan !== "edu" && plan !== "aadab") plan = "";

    var course = text(data.course || data.courseCode, 20).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(course)) course = "";

    var year = text(data.year, 80);
    var semester = text(data.semester, 40);
    var category = text(data.category, 40);

    if (!plan && !course && !year && !semester && !category) return null;

    return {
      plan: plan,
      course: course,
      year: year,
      semester: semester,
      category: category,
    };
  }

  function normalize(action) {
    if (!action || typeof action !== "object") return null;

    var tool = text(action.tool, 30);
    if (!TOOLS[tool]) return null;

    var data = null;
    if (tool === "gpa") data = normalizeGpa(action.data);
    else if (tool === "tawtheeq") data = normalizeTawtheeq(action.data);
    else if (tool === "wheel") data = normalizeWheel(action.data);
    else if (tool === "study-plan") data = normalizeStudyPlan(action.data);

    if (!data) return null;

    return { tool: tool, data: data };
  }

  function computeGpa(data) {
    if (!data || !Array.isArray(data.courses)) return null;

    var points = 0;
    var hours = 0;
    var courses = 0;

    data.courses.forEach(function (course) {
      var grade = GRADE_SCALE[course.grade];
      if (grade === undefined || !(course.hours > 0)) return;

      points += grade * course.hours;
      hours += course.hours;
      courses += 1;
    });

    if (courses === 0) return null;

    var gpa = points / hours;

    if (
      data.mode === "cumulative" &&
      data.previousGpa != null &&
      data.previousHours > 0
    ) {
      var totalPoints = data.previousGpa * data.previousHours + points;
      var totalHours = data.previousHours + hours;
      gpa = totalHours > 0 ? totalPoints / totalHours : 0;
      return {
        gpa: gpa,
        hours: totalHours,
        semesterHours: hours,
        courses: courses,
        cumulative: true,
      };
    }

    return {
      gpa: gpa,
      hours: hours,
      semesterHours: hours,
      courses: courses,
      cumulative: false,
    };
  }

  function formatNumber(value) {
    return Number(value).toFixed(2);
  }

  function formatHours(value) {
    var count = Number(value);
    if (count === 1) return "ساعة واحدة";
    if (count === 2) return "ساعتان";
    if (count >= 3 && count <= 10) return count + " ساعات";
    return count + " ساعة";
  }

  function summary(action) {
    var data = action.data;
    var lines = [];
    var result = "";
    var note = "";

    if (action.tool === "gpa") {
      var computed = computeGpa(data);
      var validCourses = data.courses.length;

      lines.push(
        validCourses +
          (validCourses === 1 ? " مادة" : " مواد") +
          (computed ? " · " + formatHours(computed.semesterHours) : "")
      );

      if (computed) {
        result =
          "المعدل " +
          (computed.cumulative ? "التراكمي الجديد" : "الفصلي") +
          ": " +
          formatNumber(computed.gpa);

        var missingHours = data.courses.some(function (course) {
          return !(course.hours > 0);
        });
        if (missingHours) note = "بعض المواد تحتاج إدخال الساعات.";
      } else {
        note = "أكمل الساعات والدرجات داخل الحاسبة للحصول على النتيجة.";
      }
    } else if (action.tool === "tawtheeq") {
      lines.push(TAWTHEEQ_TYPES[data.type] || "مرجع");
      if (data.fields.title) lines.push(data.fields.title);
      if (data.fields.authors) lines.push(data.fields.authors);
    } else if (action.tool === "wheel") {
      lines.push(
        data.names.length +
          (data.names.length === 1 ? " اسم" : " أسماء") +
          (data.spin ? " · جاهزة للتدوير" : "")
      );
    } else if (action.tool === "study-plan") {
      if (data.plan) {
        lines.push(data.plan === "edu" ? "التربية في اللغة العربية" : "اللغة العربية وآدابها");
      }
      if (data.course) lines.push(data.course);
      if (data.year) lines.push(data.year.replace("السنة الدراسية", "السنة"));
      if (data.semester) lines.push(data.semester);
    }

    return { lines: lines, result: result, note: note };
  }

  function targetUrl(action) {
    var info = TOOLS[action.tool];
    if (!info) return "";

    if (action.tool === "study-plan" && action.data.course) {
      var plan = action.data.plan || "edu";
      return (
        BASE +
        "tools/study-plan/" +
        encodeURIComponent(plan) +
        "/" +
        encodeURIComponent(action.data.course)
      );
    }

    return info.path;
  }

  function savePending(action) {
    try {
      window.localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          action: action,
          savedAt: Date.now(),
        })
      );
    } catch (error) {
      // التخزين قد يكون معطلاً؛ نكمل بالتنقل المباشر.
    }
  }

  function readPending() {
    try {
      var raw = window.localStorage.getItem(PENDING_KEY);
      if (!raw) return null;

      var saved = JSON.parse(raw);
      if (!saved || !saved.action || !Number.isFinite(Number(saved.savedAt))) {
        window.localStorage.removeItem(PENDING_KEY);
        return null;
      }

      if (Date.now() - Number(saved.savedAt) > MAX_AGE_MS) {
        window.localStorage.removeItem(PENDING_KEY);
        return null;
      }

      return saved.action;
    } catch (error) {
      return null;
    }
  }

  function clearPending() {
    try {
      window.localStorage.removeItem(PENDING_KEY);
    } catch (error) {
      // التخزين معطّل.
    }
  }

  function showToast(message) {
    var toast = document.querySelector(".ibnfaris-tool-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "ibnfaris-tool-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.dir = "rtl";
      toast.style.cssText = [
        "position:fixed",
        "z-index:10000",
        "left:50%",
        "bottom:24px",
        "transform:translateX(-50%)",
        "max-width:min(92vw,440px)",
        "padding:11px 18px",
        "border-radius:14px",
        "background:var(--rawafid-primary,var(--primary-color,CanvasText))",
        "color:var(--rawafid-on-primary,var(--if-on-sand,Canvas))",
        "font-family:var(--font-body,'IBM Plex Sans Arabic',sans-serif)",
        "font-size:14px",
        "line-height:1.6",
        "text-align:center",
        "box-shadow:var(--if-shadow-subtle,none)",
        "opacity:0",
        "transition:opacity .2s ease",
      ].join(";");
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    window.requestAnimationFrame(function () {
      toast.style.opacity = "1";
    });

    window.clearTimeout(toast.__hideTimer);
    toast.__hideTimer = window.setTimeout(function () {
      toast.style.opacity = "0";
    }, 3600);
  }

  function dispatch(action) {
    document.dispatchEvent(
      new CustomEvent("ibnfaris:apply-tool", { detail: action })
    );
  }

  function open(action) {
    var normalized = normalize(action);
    if (!normalized) return "invalid";

    if (currentTool() === normalized.tool) {
      dispatch(normalized);
      showToast("تم تطبيق بيانات ابن فارس على " + TOOLS[normalized.tool].short + ".");

      // على الجوال تغطي اللوحة الأداة؛ نغلقها بعد التطبيق ليرى المستخدم النتيجة.
      if (
        window.matchMedia &&
        window.matchMedia("(max-width: 767px)").matches &&
        window.IbnFarisSheet &&
        typeof window.IbnFarisSheet.close === "function"
      ) {
        window.setTimeout(function () {
          window.IbnFarisSheet.close();
        }, 450);
      }

      return "applied";
    }

    savePending(normalized);

    var url = targetUrl(normalized);
    if (!url) return "invalid";

    window.location.assign(url);
    return "navigating";
  }

  function consumePending() {
    var pending = readPending();
    clearPending();

    if (!pending) return;

    var normalized = normalize(pending);
    if (!normalized || currentTool() !== normalized.tool) return;

    // ننتظر انتهاء استعادة حالة الأداة من التخزين المحلي.
    window.setTimeout(function () {
      dispatch(normalized);
      showToast("تم تطبيق بيانات ابن فارس على " + TOOLS[normalized.tool].short + ".");
    }, 260);
  }

  function createCard(action) {
    var normalized = normalize(action);
    if (!normalized) return null;

    var info = TOOLS[normalized.tool];
    var details = summary(normalized);

    var card = document.createElement("div");
    card.className = "if-tool-card";
    card.setAttribute("dir", "rtl");
    card.setAttribute("data-tool", normalized.tool);

    var head = document.createElement("div");
    head.className = "if-tool-head";

    var icon = document.createElement("span");
    icon.className = "if-tool-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = info.icon;

    var heads = document.createElement("div");
    heads.className = "if-tool-heads";

    var label = document.createElement("span");
    label.className = "if-tool-label";
    label.textContent = "أداة جاهزة";

    var title = document.createElement("strong");
    title.className = "if-tool-title";
    title.textContent = info.name;

    heads.appendChild(label);
    heads.appendChild(title);

    head.appendChild(icon);
    head.appendChild(heads);

    var body = document.createElement("div");
    body.className = "if-tool-body";

    if (details.lines.length > 0) {
      var meta = document.createElement("p");
      meta.className = "if-tool-meta";
      meta.textContent = details.lines.join(" · ");
      body.appendChild(meta);
    }

    if (details.result) {
      var result = document.createElement("p");
      result.className = "if-tool-result";
      result.textContent = details.result;
      body.appendChild(result);
    }

    if (details.note) {
      var note = document.createElement("p");
      note.className = "if-tool-note";
      note.textContent = details.note;
      body.appendChild(note);
    }

    var actions = document.createElement("div");
    actions.className = "if-tool-actions";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "if-tool-button";
    button.textContent =
      currentTool() === normalized.tool
        ? "طبّق البيانات الآن"
        : "افتح " + info.short + " وطبّق البيانات";

    button.addEventListener("click", function () {
      var outcome = open(normalized);
      if (outcome === "applied") {
        button.textContent = "تم التطبيق";
        button.disabled = true;
      }
    });

    actions.appendChild(button);

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actions);

    return card;
  }

  window.IbnFarisTools = {
    tools: TOOLS,
    currentTool: currentTool,
    normalize: normalize,
    open: open,
    createCard: createCard,
    summary: summary,
    computeGpa: computeGpa,
    targetUrl: targetUrl,
    gradeScale: GRADE_SCALE,
    maxActions: MAX_ACTIONS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", consumePending);
  } else {
    consumePending();
  }
})();
