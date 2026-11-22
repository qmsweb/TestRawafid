/* ============================================================
   لوحة تحكم ابن فارس — واجهة الإدارة
   ============================================================
   • لا تحتوي أي سرّ: تستخدم مفتاح النشر العام + جلسة Google.
   • التحقق الحقيقي من صلاحية الحساب يجري داخل دالة
     ibn-faris-admin على الخادم؛ فحص البريد هنا لتجربة المستخدم فقط.
   ============================================================ */
(function () {
  "use strict";

  var config = window.IBNAFARIS_CONFIG || {};
  var SUPABASE_URL = String(config.supabaseUrl || "").replace(/\/+$/, "");
  var ANON_KEY = String(config.supabaseAnonKey || "");
  var FUNCTION_NAME = String(config.adminFunctionName || "ibn-faris-admin");

  var state = {
    resolved: false,
    allowed: false,
    loaded: false,
    loading: false,
    checking: false,
    page: 1,
    pageSize: 25,
    search: "",
    total: 0,
    editing: null,
    formDirty: false,
    requestId: 0,
  };

  var el = {};
  var numberFormat = new Intl.NumberFormat("ar-OM-u-nu-latn");
  var toastTimer = null;
  var searchTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    el.app = byId("ad-app");
    el.account = byId("ad-account");
    el.accountEmail = byId("ad-account-email");
    el.signout = byId("ad-signout");
    el.gate = byId("ad-gate");
    el.gateStatus = byId("ad-gate-status");
    el.signin = byId("ad-signin");
    el.gateSignout = byId("ad-gate-signout");
    el.main = byId("ad-main");

    el.statRequests = byId("ad-stat-requests");
    el.statRequestsSub = byId("ad-stat-requests-sub");
    el.statBudget = byId("ad-stat-budget");
    el.statBudgetSub = byId("ad-stat-budget-sub");
    el.statUsers = byId("ad-stat-users");
    el.statUsersSub = byId("ad-stat-users-sub");
    el.statCustom = byId("ad-stat-custom");
    el.statCustomSub = byId("ad-stat-custom-sub");

    el.globalForm = byId("ad-global-form");
    el.globalLimit = byId("ad-global-limit");
    el.globalBudget = byId("ad-global-budget");
    el.globalLimitEnv = byId("ad-global-limit-env");
    el.globalBudgetEnv = byId("ad-global-budget-env");
    el.globalSave = byId("ad-global-save");
    el.globalReset = byId("ad-global-reset");
    el.globalSource = byId("ad-global-source");
    el.globalMeta = byId("ad-global-meta");

    el.usersBody = byId("ad-users-body");
    el.usersEmpty = byId("ad-users-empty");
    el.usersMeta = byId("ad-users-meta");
    el.search = byId("ad-search");
    el.refresh = byId("ad-refresh");
    el.prev = byId("ad-prev");
    el.next = byId("ad-next");
    el.pageLabel = byId("ad-page-label");

    el.recentBody = byId("ad-recent-body");

    el.dialog = byId("ad-dialog");
    el.dialogUser = byId("ad-dialog-user");
    el.dialogLimit = byId("ad-dialog-limit");
    el.dialogSubscriber = byId("ad-dialog-subscriber");
    el.dialogNote = byId("ad-dialog-note");
    el.dialogSave = byId("ad-dialog-save");
    el.dialogResetUsage = byId("ad-dialog-reset-usage");
    el.dialogClear = byId("ad-dialog-clear");
    el.dialogCancel = byId("ad-dialog-cancel");
    el.dialogClose = byId("ad-dialog-close");

    el.toast = byId("ad-toast");
  }

  /* ============================================================
     أدوات مساعدة
     ============================================================ */

  function setText(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function fmtNum(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) num = 0;
    return numberFormat.format(num);
  }

  function fmtMoney(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || num < 0) num = 0;
    return "$" + (num > 0 && num < 1 ? num.toFixed(4) : num.toFixed(2));
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    try {
      return date.toLocaleString("ar-OM-u-nu-latn", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch (error) {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function toast(message, isError) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.classList.toggle("is-error", Boolean(isError));
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.toast.hidden = true;
    }, 4200);
  }

  function setBusy(isBusy) {
    state.loading = Boolean(isBusy);
    if (el.refresh) el.refresh.disabled = isBusy;
    if (el.globalSave) el.globalSave.disabled = isBusy;
    if (el.globalReset) el.globalReset.disabled = isBusy;
  }

  /* ============================================================
     الاتصال بدالة الإدارة
     ============================================================ */

  function api(action, payload) {
    var token =
      window.RawafidAuth && window.RawafidAuth.getAccessToken
        ? window.RawafidAuth.getAccessToken()
        : null;

    if (!token) {
      return Promise.reject(new Error("انتهت الجلسة. أعد تسجيل الدخول."));
    }

    return fetch(SUPABASE_URL + "/functions/v1/" + FUNCTION_NAME, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!response.ok) {
            var message =
              data && data.error ? data.error : "تعذّر تنفيذ الطلب.";
            var error = new Error(message);
            error.status = response.status;
            throw error;
          }
          return data;
        });
    });
  }

  /* ============================================================
     بوابة الدخول
     ============================================================ */

  function showGate(mode, message) {
    state.allowed = false;
    if (el.gate) el.gate.hidden = false;
    if (el.main) el.main.hidden = true;
    if (el.account) el.account.hidden = true;
    if (el.signin) el.signin.hidden = mode !== "signed-out";
    if (el.gateSignout) {
      el.gateSignout.hidden = mode !== "denied" && mode !== "error";
    }
    if (el.gateStatus) {
      el.gateStatus.textContent = message || "";
      el.gateStatus.classList.toggle(
        "is-error",
        mode === "denied" || mode === "error"
      );
    }
    if (el.app) el.app.setAttribute("data-state", mode);
  }

  function showDashboard(email) {
    state.allowed = true;
    if (el.gate) el.gate.hidden = true;
    if (el.main) el.main.hidden = false;
    if (el.account) el.account.hidden = false;
    if (el.accountEmail) {
      el.accountEmail.textContent = email || "";
      el.accountEmail.title = email || "";
    }
    if (el.app) el.app.setAttribute("data-state", "ready");
  }

  function handleAuth(snapshot) {
    if (!snapshot) return;

    if (!snapshot.resolved) {
      showGate("checking", "جارٍ التحقق من الجلسة…");
      return;
    }

    var user = snapshot.user || null;
    if (!user) {
      state.allowed = false;
      state.loaded = false;
      state.checking = false;
      showGate("signed-out", "");
      return;
    }

    // الصلاحية تُقرأ من الخادم؛ لا نعتمد على بريد مكتوب في المتصفح.
    if (state.allowed) {
      if (el.accountEmail) {
        el.accountEmail.textContent = user.email || "";
        el.accountEmail.title = user.email || "";
      }
      return;
    }

    if (state.checking) return;
    verifyAccess(user);
  }

  function verifyAccess(user) {
    state.checking = true;
    showGate("checking", "جارٍ التحقق من صلاحية الحساب…");

    api("overview", { page: 1, pageSize: state.pageSize })
      .then(function (data) {
        state.checking = false;
        state.loaded = true;
        state.page = 1;
        showDashboard(user.email || "");
        renderOverview(data);
      })
      .catch(function (error) {
        state.checking = false;
        if (error.status === 401 || error.status === 403) {
          showGate(
            "denied",
            error.message ||
              "هذا الحساب لا يملك صلاحية الدخول إلى لوحة التحكم."
          );
          return;
        }
        showGate(
          "error",
          error.message || "تعذّر الاتصال بلوحة التحكم. حاول مرة أخرى."
        );
      });
  }

  /* ============================================================
     تحميل البيانات ورسمها
     ============================================================ */

  function loadOverview() {
    if (!state.allowed) return;

    var requestId = ++state.requestId;
    setBusy(true);

    api("overview", {
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
    })
      .then(function (data) {
        if (requestId !== state.requestId) return;
        state.loaded = true;
        renderOverview(data);
      })
      .catch(function (error) {
        if (requestId !== state.requestId) return;
        if (error.status === 401 || error.status === 403) {
          showGate(
            "denied",
            error.message ||
              "هذا الحساب لا يملك صلاحية الدخول إلى لوحة التحكم."
          );
          return;
        }
        toast(error.message || "تعذّر تحميل بيانات اللوحة.", true);
      })
      .finally(function () {
        if (requestId === state.requestId) setBusy(false);
      });
  }

  function renderOverview(data) {
    if (!data) return;
    renderStats(data);
    renderGlobalSettings(data.settings);
    renderUsers(data.users);
    renderRecent(data.recent);
  }

  function renderStats(data) {
    var settings = data.settings || {};
    var today = data.today || {};
    var counts = data.counts || {};

    setText(el.statRequests, fmtNum(today.requestsRemaining));
    setText(
      el.statRequestsSub,
      "استُخدم " +
        fmtNum(today.requestsUsed) +
        " من " +
        fmtNum(settings.globalLimit) +
        " طلباً اليوم"
    );

    if (today.budgetRemainingUsd === null || today.budgetRemainingUsd === undefined) {
      setText(el.statBudget, "بلا حد");
      setText(
        el.statBudgetSub,
        "تكلفة اليوم " + fmtMoney(today.costUsd) + " · لا سقف دولاري"
      );
    } else {
      setText(el.statBudget, fmtMoney(today.budgetRemainingUsd));
      setText(
        el.statBudgetSub,
        "تكلفة اليوم " +
          fmtMoney(today.costUsd) +
          " من " +
          fmtMoney(settings.globalBudgetUsd)
      );
    }

    setText(el.statUsers, fmtNum(counts.activeToday));
    setText(
      el.statUsersSub,
      "من أصل " + fmtNum(counts.totalUsers) + " حساباً مسجّلاً"
    );

    setText(el.statCustom, fmtNum(counts.customLimits));
    setText(
      el.statCustomSub,
      "السقف الافتراضي " +
        fmtNum(settings.defaultUserLimit) +
        " رسالة لكل حساب"
    );
  }

  function renderGlobalSettings(settings) {
    if (!settings) return;

    if (!state.formDirty) {
      if (el.globalLimit) el.globalLimit.value = String(settings.globalLimit);
      if (el.globalBudget) el.globalBudget.value = String(settings.globalBudgetUsd);
    }

    setText(el.globalLimitEnv, fmtNum(settings.envGlobalLimit));
    setText(el.globalBudgetEnv, fmtMoney(settings.envGlobalBudgetUsd));

    if (el.globalSource) {
      var fromDashboard =
        settings.limitSource === "dashboard" || settings.budgetSource === "dashboard";
      el.globalSource.textContent = fromDashboard
        ? "مضبوط من اللوحة"
        : "القيم الافتراضية";
    }

    if (el.globalMeta) {
      if (settings.updatedAt) {
        setText(
          el.globalMeta,
          "آخر تعديل: " +
            fmtDateTime(settings.updatedAt) +
            (settings.updatedBy ? " بواسطة " + settings.updatedBy : "")
        );
      } else {
        setText(el.globalMeta, "لم يُعدّل السقف العام من اللوحة بعد.");
      }
    }
  }

  function renderUsers(users) {
    if (!users) return;

    state.total = Number(users.total) || 0;

    if (el.usersBody) el.usersBody.textContent = "";
    var items = Array.isArray(users.items) ? users.items : [];

    items.forEach(function (user) {
      if (el.usersBody) el.usersBody.appendChild(buildUserRow(user));
    });

    if (el.usersEmpty) el.usersEmpty.hidden = items.length !== 0;

    var from = state.total ? (users.page - 1) * users.pageSize + 1 : 0;
    var to = from ? from + items.length - 1 : 0;

    setText(
      el.usersMeta,
      fmtNum(state.total) +
        " حساباً" +
        (users.search ? " مطابقاً للبحث" : "") +
        (from ? " · عرض " + fmtNum(from) + "–" + fmtNum(to) : "")
    );

    var pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    setText(
      el.pageLabel,
      "صفحة " + fmtNum(users.page) + " من " + fmtNum(pages)
    );
    if (el.prev) el.prev.disabled = users.page <= 1;
    if (el.next) el.next.disabled = users.page >= pages;
  }

  function buildUserRow(user) {
    var row = document.createElement("tr");

    var accountCell = document.createElement("td");
    var accountWrap = document.createElement("div");
    accountWrap.className = "ad-user-cell";

    var email = document.createElement("span");
    email.className = "ad-user-email";
    email.textContent = user.email || user.id;
    accountWrap.appendChild(email);

    if (user.name) {
      var name = document.createElement("span");
      name.className = "ad-user-name";
      name.textContent = user.name;
      accountWrap.appendChild(name);
    }

    accountCell.appendChild(accountWrap);
    row.appendChild(accountCell);

    var limitCell = document.createElement("td");
    limitCell.className = "ad-num";
    limitCell.textContent = fmtNum(user.limit);
    row.appendChild(limitCell);

    var usedCell = document.createElement("td");
    usedCell.className = "ad-num";
    usedCell.textContent = fmtNum(user.usedToday);
    row.appendChild(usedCell);

    var remainingCell = document.createElement("td");
    remainingCell.className =
      "ad-num ad-remaining" + (user.remaining <= 0 ? " is-empty" : "");
    remainingCell.textContent = fmtNum(user.remaining);
    row.appendChild(remainingCell);

    var tokensCell = document.createElement("td");
    tokensCell.className = "ad-num";
    tokensCell.textContent =
      fmtNum(user.promptTokens) + " / " + fmtNum(user.completionTokens);
    row.appendChild(tokensCell);

    var costCell = document.createElement("td");
    costCell.className = "ad-num";
    costCell.textContent = fmtMoney(user.costUsd);
    row.appendChild(costCell);

    var statusCell = document.createElement("td");
    var chips = document.createElement("div");
    chips.className = "ad-chips";

    var limitChip = document.createElement("span");
    limitChip.className = "ad-chip" + (user.isCustom ? " ad-chip--custom" : "");
    limitChip.textContent = user.isCustom ? "سقف مخصّص" : "السقف الافتراضي";
    chips.appendChild(limitChip);

    if (user.isSubscriber) {
      var subscriberChip = document.createElement("span");
      subscriberChip.className = "ad-chip ad-chip--subscriber";
      subscriberChip.textContent = "مشترك";
      chips.appendChild(subscriberChip);
    }

    statusCell.appendChild(chips);
    row.appendChild(statusCell);

    var actionsCell = document.createElement("td");
    var actions = document.createElement("div");
    actions.className = "ad-row-actions";

    var editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ad-btn ad-btn--ghost ad-btn--sm";
    editButton.textContent = "تعديل";
    editButton.addEventListener("click", function () {
      openDialog(user);
    });
    actions.appendChild(editButton);

    actionsCell.appendChild(actions);
    row.appendChild(actionsCell);

    return row;
  }

  function renderRecent(recent) {
    if (!el.recentBody) return;
    el.recentBody.textContent = "";

    var rows = Array.isArray(recent) ? recent : [];
    if (!rows.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 3;
      emptyCell.className = "ad-empty";
      emptyCell.textContent = "لا توجد بيانات استهلاك بعد.";
      emptyRow.appendChild(emptyCell);
      el.recentBody.appendChild(emptyRow);
      return;
    }

    rows.forEach(function (day) {
      var row = document.createElement("tr");

      var dayCell = document.createElement("td");
      dayCell.className = "ad-num";
      dayCell.textContent = day.day;
      row.appendChild(dayCell);

      var requestsCell = document.createElement("td");
      requestsCell.className = "ad-num";
      requestsCell.textContent = fmtNum(day.requestsUsed);
      row.appendChild(requestsCell);

      var costCell = document.createElement("td");
      costCell.className = "ad-num";
      costCell.textContent = fmtMoney(day.costUsd);
      row.appendChild(costCell);

      el.recentBody.appendChild(row);
    });
  }

  /* ============================================================
     نافذة تعديل سقف حساب
     ============================================================ */

  function openDialog(user) {
    state.editing = user;
    setText(el.dialogUser, user.email || user.id);
    if (el.dialogLimit) el.dialogLimit.value = String(user.limit);
    if (el.dialogSubscriber) el.dialogSubscriber.checked = Boolean(user.isSubscriber);
    if (el.dialogNote) el.dialogNote.value = user.note || "";

    if (el.dialog && typeof el.dialog.showModal === "function") {
      if (!el.dialog.open) el.dialog.showModal();
    } else if (el.dialog) {
      el.dialog.setAttribute("open", "");
    }
  }

  function closeDialog() {
    state.editing = null;
    if (!el.dialog) return;
    if (typeof el.dialog.close === "function" && el.dialog.open) {
      el.dialog.close();
    } else {
      el.dialog.removeAttribute("open");
    }
  }

  function setDialogBusy(isBusy) {
    [el.dialogSave, el.dialogResetUsage, el.dialogClear].forEach(function (button) {
      if (button) button.disabled = isBusy;
    });
  }

  function saveUserLimit() {
    var user = state.editing;
    if (!user) return;

    var limit = Number(el.dialogLimit.value);
    if (
      String(el.dialogLimit.value).trim() === "" ||
      !Number.isFinite(limit) ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > 100000
    ) {
      toast("السقف اليومي يجب أن يكون عدداً صحيحاً بين 0 و100000.", true);
      return;
    }

    setDialogBusy(true);
    api("set-user-limit", {
      userId: user.id,
      dailyLimit: limit,
      isSubscriber: Boolean(el.dialogSubscriber.checked),
      note: el.dialogNote.value,
    })
      .then(function () {
        closeDialog();
        toast("تم تحديث سقف الحساب.");
        loadOverview();
      })
      .catch(function (error) {
        toast(error.message || "تعذّر تحديث سقف الحساب.", true);
      })
      .finally(function () {
        setDialogBusy(false);
      });
  }

  function clearUserLimit() {
    var user = state.editing;
    if (!user) return;

    if (
      !window.confirm(
        "ستُحذف التخصيصات ويعود الحساب إلى السقف الافتراضي. هل تريد المتابعة؟"
      )
    ) {
      return;
    }

    setDialogBusy(true);
    api("clear-user-limit", { userId: user.id })
      .then(function () {
        closeDialog();
        toast("أُعيد الحساب إلى السقف الافتراضي.");
        loadOverview();
      })
      .catch(function (error) {
        toast(error.message || "تعذّر حذف التخصيص.", true);
      })
      .finally(function () {
        setDialogBusy(false);
      });
  }

  function resetUserUsage() {
    var user = state.editing;
    if (!user) return;

    if (
      !window.confirm(
        "سيُصفَّر استهلاك هذا الحساب اليوم ويُخصم من إجمالي اليوم. هل تريد المتابعة؟"
      )
    ) {
      return;
    }

    setDialogBusy(true);
    api("reset-user-usage", { userId: user.id })
      .then(function (result) {
        closeDialog();
        toast("صُفِّر استهلاك اليوم (" + fmtNum(result.reset || 0) + " طلباً).");
        loadOverview();
      })
      .catch(function (error) {
        toast(error.message || "تعذّر تصفير الاستهلاك.", true);
      })
      .finally(function () {
        setDialogBusy(false);
      });
  }

  /* ============================================================
     السقف العام
     ============================================================ */

  function saveGlobalSettings(event) {
    if (event) event.preventDefault();

    var limit = Number(el.globalLimit.value);
    var budget = Number(el.globalBudget.value);

    if (
      String(el.globalLimit.value).trim() === "" ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > 100000
    ) {
      toast("السقف العام يجب أن يكون عدداً صحيحاً بين 0 و100000.", true);
      return;
    }

    if (
      String(el.globalBudget.value).trim() === "" ||
      !Number.isFinite(budget) ||
      budget < 0 ||
      budget > 10000
    ) {
      toast("الميزانية اليومية يجب أن تكون رقماً بين 0 و10000.", true);
      return;
    }

    setBusy(true);
    api("set-global", {
      globalDailyLimit: limit,
      globalDailyBudgetUsd: budget,
    })
      .then(function () {
        state.formDirty = false;
        toast("تم حفظ السقف العام. يسري على الطلبات الجديدة خلال ٣٠ ثانية.");
        loadOverview();
      })
      .catch(function (error) {
        toast(error.message || "تعذّر حفظ السقف العام.", true);
        setBusy(false);
      });
  }

  function resetGlobalSettings() {
    if (
      !window.confirm(
        "ستُعاد قيم السقف العام إلى القيم الافتراضية في أسرار الدالة. هل تريد المتابعة؟"
      )
    ) {
      return;
    }

    setBusy(true);
    api("reset-global")
      .then(function () {
        state.formDirty = false;
        toast("أُعيد السقف العام إلى القيم الافتراضية.");
        loadOverview();
      })
      .catch(function (error) {
        toast(error.message || "تعذّر إرجاع القيم الافتراضية.", true);
        setBusy(false);
      });
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bindEvents() {
    if (el.signin) {
      el.signin.addEventListener("click", function () {
        if (!window.RawafidAuth) return;
        el.signin.disabled = true;
        if (el.gateStatus) {
          el.gateStatus.textContent = "جارٍ فتح صفحة جوجل…";
          el.gateStatus.classList.remove("is-error");
        }
        Promise.resolve(window.RawafidAuth.signInWithGoogle()).catch(function () {
          el.signin.disabled = false;
          showGate("signed-out", "تعذّر بدء تسجيل الدخول. حاول مرة أخرى.");
        });
      });
    }

    function signOut() {
      if (!window.RawafidAuth) return;
      window.RawafidAuth.signOut().then(function () {
        state.loaded = false;
        state.allowed = false;
        state.checking = false;
      });
    }

    if (el.signout) el.signout.addEventListener("click", signOut);
    if (el.gateSignout) el.gateSignout.addEventListener("click", signOut);

    if (el.globalForm) el.globalForm.addEventListener("submit", saveGlobalSettings);
    if (el.globalReset) el.globalReset.addEventListener("click", resetGlobalSettings);

    [el.globalLimit, el.globalBudget].forEach(function (input) {
      if (!input) return;
      input.addEventListener("input", function () {
        state.formDirty = true;
      });
    });

    if (el.refresh) {
      el.refresh.addEventListener("click", function () {
        loadOverview();
      });
    }

    if (el.search) {
      el.search.addEventListener("input", function () {
        if (searchTimer) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function () {
          state.search = el.search.value.trim();
          state.page = 1;
          loadOverview();
        }, 350);
      });
    }

    if (el.prev) {
      el.prev.addEventListener("click", function () {
        if (state.page <= 1) return;
        state.page -= 1;
        loadOverview();
      });
    }

    if (el.next) {
      el.next.addEventListener("click", function () {
        state.page += 1;
        loadOverview();
      });
    }

    if (el.dialogSave) el.dialogSave.addEventListener("click", saveUserLimit);
    if (el.dialogClear) el.dialogClear.addEventListener("click", clearUserLimit);
    if (el.dialogResetUsage) el.dialogResetUsage.addEventListener("click", resetUserUsage);
    if (el.dialogCancel) el.dialogCancel.addEventListener("click", closeDialog);
    if (el.dialogClose) el.dialogClose.addEventListener("click", closeDialog);

    if (el.dialog) {
      el.dialog.addEventListener("click", function (event) {
        // النقر على الخلفية خارج النموذج يغلقها.
        if (event.target === el.dialog) closeDialog();
      });
      el.dialog.addEventListener("close", function () {
        state.editing = null;
        setDialogBusy(false);
      });
      el.dialog.addEventListener("submit", function (event) {
        // منع إغلاق النموذج بلا حفظ عند الضغط على Enter.
        event.preventDefault();
        saveUserLimit();
      });
    }
  }

  /* ============================================================
     الإقلاع
     ============================================================ */

  function init() {
    cacheElements();
    bindEvents();

    if (!window.RawafidAuth) {
      showGate("signed-out", "تعذّر تحميل خدمة تسجيل الدخول. أعد تحميل الصفحة.");
      return;
    }

    window.RawafidAuth.onChange(handleAuth);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
