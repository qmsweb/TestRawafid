/* ============================================================
   روافد — تسجيل الدخول بحساب Google
   ============================================================
   • يستخدم Supabase Auth مع مزوّد Google، ولا يحتوي أي سرّ:
     supabaseUrl ومفتاح anon العامّان في ibn-faris-config.js.
   • يتحقق من الجلسة ويجدّدها تلقائياً، ويحفظها في localStorage
     (مفتاح Supabase نفسه) فلا يُسأل المستخدم كل مرة.
   • يجعل الجلسة متاحة لبقية سكربتات روافد عبر window.RawafidAuth،
     ويطلق حدث rawafid:auth عند كل تغيّر في حالة الدخول.
   • المتصفح يعود إلى الصفحة نفسها بعد Google؛ ويُحتفظ بعلامة في
     sessionStorage حتى تفتح اللوحة العائمة نفسها عند العودة.
   ============================================================ */
(function () {
  "use strict";

  var config = window.IBNAFARIS_CONFIG || {};
  var SUPABASE_URL = String(config.supabaseUrl || "").replace(/\/+$/, "");
  var ANON_KEY = String(config.supabaseAnonKey || "");
  var RETURN_KEY = "rawafid-auth-return";
  var RETURN_TTL_MS = 10 * 60 * 1000;
  var CHAT_HISTORY_KEY = "ibnfaris-rawafid-history";
  var CHAT_DRAFT_KEY = "ibnfaris-rawafid-draft";

  var client = null;
  var session = null;
  var user = null;
  var resolved = false;
  var started = false;
  var authError = null;
  var listeners = [];
  var resolveReady;
  var readyPromise = new Promise(function (resolve) {
    resolveReady = resolve;
  });

  function snapshot() {
    return {
      resolved: resolved,
      signedIn: Boolean(user),
      user: user,
      session: session,
      error: authError,
    };
  }

  function emit() {
    var detail = snapshot();
    listeners.slice().forEach(function (listener) {
      try {
        listener(detail);
      } catch (error) {
        // خطأ مستمع واحد لا يمنع الباقين.
      }
    });

    try {
      document.dispatchEvent(
        new CustomEvent("rawafid:auth", { detail: detail })
      );
    } catch (error) {
      // المتصفحات القديمة التي لا تدعم CustomEvent.
    }
  }

  function readReturnMarker() {
    try {
      var raw = window.sessionStorage.getItem(RETURN_KEY);
      if (!raw) return null;

      var data = JSON.parse(raw);
      if (!data || Date.now() - Number(data.at || 0) > RETURN_TTL_MS) {
        window.sessionStorage.removeItem(RETURN_KEY);
        return null;
      }

      return data;
    } catch (error) {
      return null;
    }
  }

  function clearReturnMarker() {
    try {
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch (error) {
      // التخزين قد يكون معطلاً.
    }
  }

  function markReturn() {
    // تُفتح اللوحة العائمة تلقائياً بعد العودة إن كان الدخول بدأ منها،
    // أما صفحة /ibn-faris/ فلا تحتاج العلامة.
    if (!document.querySelector(".if-fab")) return;

    try {
      window.sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({ at: Date.now(), path: window.location.pathname })
      );
    } catch (error) {
      // التخزين قد يكون معطلاً.
    }
  }

  function clearChatStorage() {
    try {
      window.sessionStorage.removeItem(CHAT_HISTORY_KEY);
      window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
    } catch (error) {
      // التخزين قد يكون معطلاً.
    }
  }

  function readCallbackError() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (error) {
      return;
    }

    var failed =
      params.has("error") ||
      params.has("error_description") ||
      params.has("error_code");
    if (!failed) return;

    authError = "cancelled";

    // ننظّف رابط الصفحة حتى لا تبقى رسالة الخطأ عند إعادة التحميل.
    try {
      var url = new URL(window.location.href);
      ["error", "error_code", "error_description", "state"].forEach(
        function (name) {
          url.searchParams.delete(name);
        }
      );
      window.history.replaceState({}, document.title, url.toString());
    } catch (error) {
      // history.replaceState غير متاح في بعض السياقات.
    }
  }

  function applySession(nextSession, event) {
    session = nextSession || null;
    user = session && session.user ? session.user : null;
    if (session) authError = null;

    // لا نمسح المحادثة السابقة عند الخروج من صفحة إلى أخرى؛ نمسحها فقط
    // عند تسجيل الخروج فعلياً حتى لا يراها حساب آخر في التبويب نفسه.
    if (event === "SIGNED_OUT") clearChatStorage();

    if (session) {
      window.setTimeout(clearReturnMarker, 0);
    }

    emit();
  }

  function init() {
    if (started) return readyPromise;
    started = true;

    if (
      !SUPABASE_URL ||
      !ANON_KEY ||
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
    ) {
      authError = "unavailable";
      resolved = true;
      resolveReady(null);
      emit();
      return readyPromise;
    }

    try {
      client = window.supabase.createClient(SUPABASE_URL, ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      });
    } catch (error) {
      client = null;
      authError = "unavailable";
      resolved = true;
      resolveReady(null);
      emit();
      return readyPromise;
    }

    client.auth.onAuthStateChange(function (event, nextSession) {
      applySession(nextSession, event);
    });

    client.auth
      .getSession()
      .then(function (result) {
        var current =
          result && result.data && result.data.session
            ? result.data.session
            : null;
        applySession(current, "INITIAL");
        readCallbackError();
        // إن عاد المستخدم من Google دون جلسة (إلغاء أو خطأ) فلا نعيد فتح
        // اللوحة في كل تحميل للصفحة.
        if (!session) clearReturnMarker();
        resolved = true;
        resolveReady(session);
        emit();
      })
      .catch(function () {
        authError = "failed";
        resolved = true;
        resolveReady(null);
        emit();
      });

    return readyPromise;
  }

  function signInWithGoogle() {
    if (!client) {
      return Promise.reject(new Error("auth_unavailable"));
    }

    markReturn();

    return client.auth
      .signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: { prompt: "select_account" },
        },
      })
      .then(function (result) {
        if (result && result.error) {
          clearReturnMarker();
          throw result.error;
        }
        return result;
      })
      .catch(function (error) {
        clearReturnMarker();
        throw error;
      });
  }

  function signOut() {
    clearReturnMarker();
    clearChatStorage();

    if (!client) return Promise.resolve();

    // الخروج من هذا المتصفح فقط؛ لا نُنهي جلسات المستخدم على أجهزته الأخرى.
    return client.auth.signOut({ scope: "local" }).catch(function () {});
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);

    try {
      listener(snapshot());
    } catch (error) {
      // لا نعطّل بقية المستمعين.
    }

    return function () {
      var index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  window.RawafidAuth = {
    init: init,
    ready: readyPromise,
    isReady: function () {
      return resolved;
    },
    isSignedIn: function () {
      return Boolean(user);
    },
    getUser: function () {
      return user;
    },
    getSession: function () {
      return session;
    },
    getAccessToken: function () {
      return session && session.access_token ? session.access_token : null;
    },
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onChange: onChange,
    readReturnMarker: readReturnMarker,
  };

  init();
})();
