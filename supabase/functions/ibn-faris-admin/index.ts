// ============================================================
// ابن فارس — دالة لوحة التحكم الإدارية
// ============================================================
// • تعمل على Supabase Edge Functions (Deno) ومفتاح service_role يبقى هنا.
// • لا تُقبل إلا جلسة Supabase Auth صالحة لطريقة Google، وبريد إداري
//   محدّد في IBNAFARIS_ADMIN_EMAILS (الافتراضي askdeepmind@gmail.com).
// • كل الطلبات POST بجسم JSON فيه action:
//     overview        ملخص السقف العام + استهلاك الحسابات + آخر الأيام
//     set-global      تعديل السقف العام و/أو الميزانية اليومية
//     reset-global    إرجاع السقف العام إلى قيم أسرار الدالة
//     set-user-limit  رفع/تعديل سقف حساب واحد
//     clear-user-limit حذف التخصيص وإعادة الحساب للسقف الافتراضي
//     reset-user-usage تصفير استهلاك حساب في اليوم الحالي
// • هذه الدالة لا ترسل أي محتوى محادثات؛ تقرأ عدّادات وتكتب إعدادات فقط.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const DEFAULT_ORIGINS = [
  "https://rawafid.jassim.one",
  "https://www.rawafid.jassim.one",
  "https://test-rwfd.jassim.one",
  "https://qmsweb.github.io",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || readSecretKey();

const ALLOWED_ORIGINS = new Set(
  (
    Deno.env.get("IBNAFARIS_ALLOWED_ORIGINS")?.trim() ||
    DEFAULT_ORIGINS.join(",")
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const DEFAULT_PUBLISHABLE_KEY =
  "sb_publishable_oXDBwGE8QOVhj1sNsjK_rQ_hBva9IPm";
const PUBLISHABLE_KEY = readPublishableKey() || DEFAULT_PUBLISHABLE_KEY;

const ADMIN_EMAILS = new Set(
  (
    Deno.env.get("IBNAFARIS_ADMIN_EMAILS")?.trim() || "askdeepmind@gmail.com"
  )
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

// القيم الافتراضية من الأسرار: تُعرض في اللوحة وتُستخدم إن لم يُضبط الجدول.
const ENV_GLOBAL_LIMIT = readIntEnv("IBNAFARIS_GLOBAL_DAILY_LIMIT", 400);
const ENV_GLOBAL_BUDGET_USD = readFloatEnv(
  "IBNAFARIS_GLOBAL_DAILY_BUDGET_USD",
  0,
);
const ENV_USER_LIMIT = readIntEnv(
  "IBNAFARIS_USER_DAILY_LIMIT",
  readIntEnv("IBNAFARIS_VISITOR_DAILY_LIMIT", 15),
);

const MAX_PAGE_SIZE = 100;
const MAX_GLOBAL_LIMIT = 100_000;
const MAX_GLOBAL_BUDGET_USD = 10_000;
const MAX_USER_LIMIT = 100_000;

const admin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

// ============================================================
// 1. أدوات مساعدة
// ============================================================

function readIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.round(parsed));
}

function readFloatEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readPublishableKey(): string {
  const explicit = Deno.env.get("IBNAFARIS_PUBLISHABLE_KEY")?.trim();
  if (explicit) return explicit;

  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferred = parsed.default ?? Object.values(parsed)[0];
    return typeof preferred === "string" ? preferred.trim() : "";
  } catch {
    return "";
  }
}

function readSecretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferred = parsed.default ?? Object.values(parsed)[0];
    return typeof preferred === "string" ? preferred.trim() : "";
  } catch {
    return "";
  }
}

function isApiKeyValid(request: Request): boolean {
  const provided = request.headers.get("apikey")?.trim() ?? "";
  return Boolean(PUBLISHABLE_KEY) && provided === PUBLISHABLE_KEY;
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function muscatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Muscat",
  }).format(new Date());
}

function sanitizeSearch(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .slice(0, 120)
    .replace(/[%,()*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(
  raw: unknown,
  min: number,
  max: number,
  label: string,
): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? ""));
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new HttpError(400, `${label} يجب أن يكون عدداً صحيحاً.`);
  }
  if (value < min || value > max) {
    throw new HttpError(400, `${label} يجب أن يكون بين ${min} و${max}.`);
  }
  return value;
}

function parseNumber(
  raw: unknown,
  min: number,
  max: number,
  label: string,
): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? ""));
  if (!Number.isFinite(value)) {
    throw new HttpError(400, `${label} يجب أن يكون رقماً.`);
  }
  if (value < min || value > max) {
    throw new HttpError(400, `${label} يجب أن يكون بين ${min} و${max}.`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "معرّف الحساب مطلوب.");
  }
  const value = raw.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new HttpError(400, "معرّف الحساب غير صالح.");
  }
  return value;
}

function parseNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 200);
  return value || null;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ============================================================
// 2. المصادقة: Google + بريد إداري فقط
// ============================================================

type AdminUser = { id: string; email: string };

async function authenticate(request: Request): Promise<AdminUser | null> {
  if (!admin) return null;

  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;

  try {
    const { data, error } = await admin.auth.getUser(match[1]);
    if (error || !data?.user) return null;

    const provider = data.user.app_metadata?.provider;
    const providers = data.user.app_metadata?.providers;
    const isGoogle =
      provider === "google" ||
      (Array.isArray(providers) && providers.includes("google"));
    if (!isGoogle) return null;

    const email = (data.user.email ?? "").trim().toLowerCase();
    if (!email || !ADMIN_EMAILS.has(email)) return null;

    return { id: data.user.id, email };
  } catch {
    return null;
  }
}

// ============================================================
// 3. الإعدادات العامة
// ============================================================

type SettingsRow = {
  global_daily_limit: number | null;
  global_daily_budget_usd: number | string | null;
  updated_at: string | null;
  updated_by: string | null;
};

type EffectiveSettings = {
  globalLimit: number;
  globalBudgetUsd: number;
  limitSource: "dashboard" | "env";
  budgetSource: "dashboard" | "env";
  updatedAt: string | null;
  updatedBy: string | null;
};

async function readSettings(): Promise<EffectiveSettings> {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const { data, error } = await client
    .from("ibnfaris_settings")
    .select(
      "global_daily_limit, global_daily_budget_usd, updated_at, updated_by",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") {
      throw new HttpError(
        503,
        "جدول إعدادات اللوحة غير موجود. شغّل supabase/ibn-faris-admin.sql أولاً.",
      );
    }
    throw error;
  }

  const row = data as unknown as SettingsRow | null;
  const hasLimit =
    row?.global_daily_limit !== null && row?.global_daily_limit !== undefined;
  const hasBudget =
    row?.global_daily_budget_usd !== null &&
    row?.global_daily_budget_usd !== undefined;

  return {
    globalLimit: hasLimit
      ? Math.max(0, Math.round(Number(row?.global_daily_limit)))
      : ENV_GLOBAL_LIMIT,
    globalBudgetUsd: hasBudget
      ? Math.max(0, Number(row?.global_daily_budget_usd))
      : ENV_GLOBAL_BUDGET_USD,
    limitSource: hasLimit ? "dashboard" : "env",
    budgetSource: hasBudget ? "dashboard" : "env",
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

function settingsPayload(settings: EffectiveSettings) {
  return {
    ...settings,
    envGlobalLimit: ENV_GLOBAL_LIMIT,
    envGlobalBudgetUsd: ENV_GLOBAL_BUDGET_USD,
    defaultUserLimit: ENV_USER_LIMIT,
  };
}

// ============================================================
// 4. البناء: نظرة عامة
// ============================================================

type UserOverviewRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  last_usage_day: string | null;
  requests_used_today: number | null;
  last_seen_at: string | null;
  custom_daily_limit: number | null;
  admin_note: string | null;
  is_subscriber: boolean | null;
};

type UsageRow = {
  visitor_hash: string;
  usage_day: string;
  requests_used: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

type CostRow = { visitor_hash: string; cost_usd: number | string | null };

type DailyTotalRow = {
  usage_day: string;
  requests_used: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | string | null;
};

async function buildOverview(body: Record<string, unknown>) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const settings = await readSettings();
  const today = muscatToday();

  const page = clampInt(body.page, 1, 1, 100_000);
  const pageSize = clampInt(body.pageSize, 25, 5, MAX_PAGE_SIZE);
  const search = sanitizeSearch(body.search);
  const offset = (page - 1) * pageSize;

  let usersQuery = client
    .from("ibnfaris_user_overview")
    .select("*", { count: "exact" });

  if (search) {
    const pattern = `%${search}%`;
    usersQuery = usersQuery.or(
      `email.ilike.${pattern},full_name.ilike.${pattern}`,
    );
  }

  const [
    totalsResult,
    totalUsersResult,
    activeUsersResult,
    customLimitsResult,
    recentResult,
    usersResult,
  ] = await Promise.all([
    client
      .from("ibnfaris_daily_totals")
      .select("requests_used, prompt_tokens, completion_tokens, cost_usd")
      .eq("usage_day", today)
      .maybeSingle(),
    client
      .from("ibnfaris_user_overview")
      .select("user_id", { count: "exact", head: true }),
    client
      .from("ibnfaris_guest_usage")
      .select("visitor_hash", { count: "exact", head: true })
      .eq("usage_day", today)
      .gt("requests_used", 0),
    client
      .from("ibnfaris_visitor_limits")
      .select("visitor_hash", { count: "exact", head: true }),
    client
      .from("ibnfaris_daily_totals")
      .select("usage_day, requests_used, cost_usd")
      .order("usage_day", { ascending: false })
      .limit(14),
    usersQuery
      .order("requests_used_today", { ascending: false })
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1),
  ]);

  if (totalsResult.error) throw totalsResult.error;
  if (usersResult.error) throw usersResult.error;

  const totals = (totalsResult.data ?? null) as unknown as DailyTotalRow | null;
  const requestsUsed = Math.max(0, Number(totals?.requests_used) || 0);
  const costUsd = Math.max(0, Number(totals?.cost_usd) || 0);

  const rows = (usersResult.data ?? []) as unknown as UserOverviewRow[];
  const ids = rows.map((row) => row.user_id);

  const usageByUser = new Map<string, UsageRow>();
  const costByUser = new Map<string, number>();

  if (ids.length) {
    const startOfDay = `${today}T00:00:00+04:00`;
    const [usageResult, costsResult] = await Promise.all([
      client
        .from("ibnfaris_guest_usage")
        .select(
          "visitor_hash, usage_day, requests_used, prompt_tokens, completion_tokens",
        )
        .in("visitor_hash", ids),
      client
        .from("ibnfaris_usage_log")
        .select("visitor_hash, cost_usd")
        .in("visitor_hash", ids)
        .gte("created_at", startOfDay),
    ]);

    if (!usageResult.error) {
      for (const row of (usageResult.data ?? []) as unknown as UsageRow[]) {
        usageByUser.set(row.visitor_hash, row);
      }
    }

    if (!costsResult.error) {
      for (const row of (costsResult.data ?? []) as unknown as CostRow[]) {
        const current = costByUser.get(row.visitor_hash) ?? 0;
        costByUser.set(
          row.visitor_hash,
          current + Math.max(0, Number(row.cost_usd) || 0),
        );
      }
    }
  }

  const users = rows.map((row) => {
    const customLimit =
      row.custom_daily_limit === null || row.custom_daily_limit === undefined
        ? null
        : Math.max(0, Number(row.custom_daily_limit));
    const limit = customLimit === null ? ENV_USER_LIMIT : customLimit;
    const usedToday = Math.max(0, Number(row.requests_used_today) || 0);
    const usage = usageByUser.get(row.user_id);
    const usageIsToday = usage?.usage_day === today;

    return {
      id: row.user_id,
      email: row.email,
      name: row.full_name,
      limit,
      isCustom: customLimit !== null,
      isSubscriber: row.is_subscriber === true,
      note: row.admin_note,
      usedToday,
      remaining: Math.max(0, limit - usedToday),
      promptTokens: usageIsToday
        ? Math.max(0, Number(usage?.prompt_tokens) || 0)
        : 0,
      completionTokens: usageIsToday
        ? Math.max(0, Number(usage?.completion_tokens) || 0)
        : 0,
      costUsd: Math.max(0, costByUser.get(row.user_id) ?? 0),
      lastUsageDay: row.last_usage_day,
      lastSeenAt: row.last_seen_at,
    };
  });

  const recent = (
    (recentResult.data ?? []) as unknown as DailyTotalRow[]
  ).map((row) => ({
    day: row.usage_day,
    requestsUsed: Math.max(0, Number(row.requests_used) || 0),
    costUsd: Math.max(0, Number(row.cost_usd) || 0),
  }));

  return {
    settings: settingsPayload(settings),
    today: {
      date: today,
      requestsUsed,
      promptTokens: Math.max(0, Number(totals?.prompt_tokens) || 0),
      completionTokens: Math.max(0, Number(totals?.completion_tokens) || 0),
      costUsd,
      requestsRemaining: Math.max(0, settings.globalLimit - requestsUsed),
      budgetRemainingUsd:
        settings.globalBudgetUsd > 0
          ? Math.max(0, settings.globalBudgetUsd - costUsd)
          : null,
    },
    counts: {
      totalUsers: totalUsersResult.count ?? 0,
      activeToday: activeUsersResult.count ?? 0,
      customLimits: customLimitsResult.count ?? 0,
    },
    users: {
      items: users,
      page,
      pageSize,
      total: usersResult.count ?? 0,
      search,
    },
    recent,
  };
}

// ============================================================
// 5. الأوامر
// ============================================================

async function setGlobalSettings(
  body: Record<string, unknown>,
  user: AdminUser,
) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const globalLimit = parseInteger(
    body.globalDailyLimit,
    0,
    MAX_GLOBAL_LIMIT,
    "السقف العام اليومي",
  );
  const globalBudgetUsd = parseNumber(
    body.globalDailyBudgetUsd,
    0,
    MAX_GLOBAL_BUDGET_USD,
    "الميزانية اليومية",
  );

  const { error } = await client.from("ibnfaris_settings").upsert(
    {
      id: 1,
      global_daily_limit: globalLimit,
      global_daily_budget_usd: globalBudgetUsd,
      updated_at: new Date().toISOString(),
      updated_by: user.email,
    },
    { onConflict: "id" },
  );

  if (error) throw error;

  return { ok: true, settings: settingsPayload(await readSettings()) };
}

async function resetGlobalSettings(user: AdminUser) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const { error } = await client
    .from("ibnfaris_settings")
    .update({
      global_daily_limit: null,
      global_daily_budget_usd: null,
      updated_at: new Date().toISOString(),
      updated_by: user.email,
    })
    .eq("id", 1);

  if (error) throw error;

  return { ok: true, settings: settingsPayload(await readSettings()) };
}

async function setUserLimit(body: Record<string, unknown>) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const userId = parseUuid(body.userId);
  const dailyLimit = parseInteger(
    body.dailyLimit,
    0,
    MAX_USER_LIMIT,
    "سقف الحساب",
  );
  const note = parseNote(body.note);
  const isSubscriber = body.isSubscriber === true;

  const { data: account, error: accountError } = await client
    .from("ibnfaris_user_overview")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (accountError) throw accountError;
  if (!account) throw new HttpError(404, "لا يوجد حساب بهذا المعرّف.");

  const { error } = await client.from("ibnfaris_visitor_limits").upsert(
    {
      visitor_hash: userId,
      daily_limit: dailyLimit,
      note,
      is_subscriber: isSubscriber,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "visitor_hash" },
  );

  if (error) throw error;

  return { ok: true };
}

async function clearUserLimit(body: Record<string, unknown>) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const userId = parseUuid(body.userId);

  const { error } = await client
    .from("ibnfaris_visitor_limits")
    .delete()
    .eq("visitor_hash", userId);

  if (error) throw error;

  return { ok: true };
}

async function resetUserUsage(body: Record<string, unknown>) {
  const client = admin;
  if (!client) throw new HttpError(503, "خدمة لوحة التحكم غير مهيّأة.");

  const userId = parseUuid(body.userId);
  const { data, error } = await client.rpc(
    "ibnfaris_admin_reset_user_usage",
    { p_user_id: userId },
  );

  if (error) throw error;

  const result = (data ?? {}) as { ok?: boolean; reset?: number };
  if (result.ok === false) {
    throw new HttpError(400, "تعذّر تصفير استهلاك هذا الحساب.");
  }

  return { ok: true, reset: Math.max(0, Number(result.reset) || 0) };
}

// ============================================================
// 6. المعالج الرئيسي
// ============================================================

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (!isOriginAllowed(origin)) {
    return jsonResponse({ error: "المصدر غير مسموح." }, 403, origin);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "الطريقة غير مدعومة." }, 405, origin);
  }

  if (!isApiKeyValid(request)) {
    return jsonResponse({ error: "الطلب غير مصرّح." }, 401, origin);
  }

  if (!admin) {
    return jsonResponse(
      { error: "لوحة التحكم غير مهيّأة على الخادم." },
      503,
      origin,
    );
  }

  const user = await authenticate(request);
  if (!user) {
    return jsonResponse(
      {
        error: "سجّل الدخول بحساب الإدارة للمتابعة.",
        reason: "admin_required",
      },
      403,
      origin,
    );
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const action = typeof body?.action === "string" ? body.action : "overview";

  try {
    switch (action) {
      case "overview":
        return jsonResponse(
          await buildOverview(body ?? {}),
          200,
          origin,
        );
      case "set-global":
        return jsonResponse(
          await setGlobalSettings(body ?? {}, user),
          200,
          origin,
        );
      case "reset-global":
        return jsonResponse(await resetGlobalSettings(user), 200, origin);
      case "set-user-limit":
        return jsonResponse(await setUserLimit(body ?? {}), 200, origin);
      case "clear-user-limit":
        return jsonResponse(await clearUserLimit(body ?? {}), 200, origin);
      case "reset-user-usage":
        return jsonResponse(await resetUserUsage(body ?? {}), 200, origin);
      default:
        return jsonResponse({ error: "أمر غير معروف." }, 400, origin);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(
        { error: error.message },
        error.status,
        origin,
      );
    }

    console.error("ibnfaris_admin_failed", action, error);
    return jsonResponse(
      { error: "تعذّر تنفيذ العملية. حاول مرة أخرى." },
      500,
      origin,
    );
  }
});
