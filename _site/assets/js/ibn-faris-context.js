/* ============================================================
   ابن فارس — سياق الصفحة
   ============================================================
   • يقرأ البيانات التي يطبعها _includes/ibn-faris-context.html.
   • يستنتج نوع الصفحة من المسار عند غياب البيانات.
   • يسمح للصفحات بتحديث السياق بعد جلب JSON
     (اسم الوحدة، العنصر المفتوح، التصفية الحالية...).
   • لا يرسل نص الصفحة ولا بياناتها الكاملة؛ فقط حقول صغيرة.
   ============================================================ */
(function () {
  "use strict";

  var seed = {};

  try {
    var node = document.getElementById("if-page-context");
    if (node && node.textContent) {
      var parsed = JSON.parse(node.textContent);
      if (parsed && typeof parsed === "object") seed = parsed;
    }
  } catch (error) {
    // السياق تحسيني فقط؛ نكمل بدونه.
  }

  var extra = {};
  var MAX_CONTEXT_CHARS = 900;

  function clean(value, max) {
    if (value == null) return "";

    return String(value)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 120);
  }

  function deriveType(path) {
    if (path.indexOf("/course/") !== -1) return "course";
    if (path.indexOf("/details/") !== -1) return "details";
    if (path.indexOf("/tools/study-plan/") !== -1) return "study-plan";
    if (path.indexOf("/exam/") !== -1) return "exam";
    if (path.indexOf("/blog/") !== -1) return "post";
    if (/\/ibn-faris\/?$/.test(path)) return "assistant";
    if (/\/search\/?$/.test(path)) return "search";
    if (path.indexOf("/tools/") !== -1) return "tool";
    return "page";
  }

  var TYPE_LABELS = {
    home: "home",
    course: "course",
    details: "details",
    "study-plan": "study-plan",
    exam: "exam",
    post: "post",
    assistant: "assistant",
    search: "search",
    tool: "tool",
    page: "page"
  };

  function readType() {
    var type = clean(extra.type || seed.type, 24);
    if (TYPE_LABELS[type]) return type;
    return deriveType(window.location.pathname || "/");
  }

  function get() {
    var path = window.location.pathname || "/";
    var context = {
      version: 1,
      path: clean(path, 240),
      type: readType(),
      title: clean(extra.title || seed.title || document.title, 160),
      description: clean(extra.description || seed.description, 300),
      courseCode: clean(extra.courseCode || seed.courseCode, 20),
      itemId: clean(extra.itemId || seed.itemId, 40),
      examCode: clean(extra.examCode || seed.examCode, 40),
      plan: clean(extra.plan || seed.plan, 40),
      group: clean(extra.group, 100),
      filter: clean(extra.filter, 40),
      query: clean(extra.query, 80)
    };

    // إزالة الحقول الفارغة يقلّل حجم الطلب والتوكنز.
    Object.keys(context).forEach(function (key) {
      if (context[key] === "" || context[key] == null) delete context[key];
    });

    // حماية أخيرة: لا نرسل سياقًا كبيرًا حتى لو أضافت صفحة حقولًا كثيرة.
    // نحذف الأقل أهمية أولًا، ونبقي العنوان والوصف لأنهما أساس الإجابة عن
    // سؤال مثل «ما هذا؟» في الصفحات التي لا يعرفها ابن فارس.
    if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
      var dropOrder = ["query", "filter", "group", "description", "title"];
      for (var index = 0; index < dropOrder.length; index += 1) {
        if (JSON.stringify(context).length <= MAX_CONTEXT_CHARS) break;
        delete context[dropOrder[index]];
      }
    }

    return context;
  }

  function update(patch) {
    if (!patch || typeof patch !== "object") return get();

    Object.keys(patch).forEach(function (key) {
      var value = patch[key];
      if (value === null || value === undefined || value === "") {
        delete extra[key];
      } else {
        extra[key] = value;
      }
    });

    try {
      document.dispatchEvent(
        new CustomEvent("ibnfaris:context", { detail: get() })
      );
    } catch (error) {
      // CustomEvent غير مدعوم في متصفحات قديمة جدًا.
    }

    return get();
  }

  window.IbnFarisPageContext = {
    get: get,
    update: update
  };

  // تخزين شعار ابن فارس والخطوط في المتصفح بعد أول زيارة.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(function () {
      // التسجيل تحسيني فقط؛ لا نعطّل المحادثة إذا فشل.
    });
  }

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker);
  }
})();
