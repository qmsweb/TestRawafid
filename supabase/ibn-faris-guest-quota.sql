-- ============================================================
-- خدمة «ابن فارس» في روافد — حصص الزوار
-- ============================================================
-- الخدمة متاحة بلا تسجيل دخول، لذلك لا نُنشئ مستخدمي Auth.
-- يتعرّف الخادم على الزائر عبر بصمة SHA-256 لعنوان IP + ملح سري،
-- ولا يُخزَّن عنوان IP الخام في قاعدة البيانات.
--
-- اليوم يُحسب بتوقيت مسقط (Asia/Muscat)، ويُصفَّر العدّاد تلقائياً
-- عند تغيّر التاريخ دون الحاجة إلى مهمة مجدولة.
--
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor داخل مشروع ابن فارس.
-- الملف آمن للتشغيل المتكرر (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. الجداول
-- ------------------------------------------------------------

create table if not exists public.ibnfaris_guest_usage (
  visitor_hash text primary key check (char_length(visitor_hash) >= 32),
  usage_day date not null default ((now() at time zone 'Asia/Muscat')::date),
  requests_used integer not null default 0 check (requests_used >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ibnfaris_guest_usage is
  'عدّاد استخدام خدمة ابن فارس لكل زائر (بصمة IP مجزّأة) خلال اليوم.';
comment on column public.ibnfaris_guest_usage.visitor_hash is
  'SHA-256 لعنوان IP مع ملح سري؛ لا يُخزَّن عنوان IP الخام.';

create table if not exists public.ibnfaris_daily_totals (
  usage_day date primary key,
  requests_used integer not null default 0 check (requests_used >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.ibnfaris_daily_totals is
  'إجمالي طلبات وتوكنات خدمة ابن فارس في اليوم، ويُستخدم لسقف الخدمة العام.';

create table if not exists public.ibnfaris_usage_log (
  id bigint generated always as identity primary key,
  visitor_hash text not null,
  model text not null check (char_length(model) between 1 and 120),
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  created_at timestamptz not null default now()
);

comment on table public.ibnfaris_usage_log is
  'سجل استهلاك مختصر لأغراض المراقبة فقط، ولا يحتوي على نص المحادثات.';

-- تكلفة DeepSeek بالدولار: تُحجز تقديريًا عند الطلب ثم تُسوّى بالتكلفة الفعلية.
alter table public.ibnfaris_daily_totals
  add column if not exists cost_usd numeric(12, 6) not null default 0
  check (cost_usd >= 0);

alter table public.ibnfaris_usage_log
  add column if not exists cost_usd numeric(12, 6) not null default 0
  check (cost_usd >= 0);

create index if not exists ibnfaris_usage_log_created_idx
  on public.ibnfaris_usage_log (created_at desc);

create index if not exists ibnfaris_usage_log_visitor_idx
  on public.ibnfaris_usage_log (visitor_hash, created_at desc);

-- ------------------------------------------------------------
-- 2. حماية الجداول: لا وصول مباشر من المتصفح
-- ------------------------------------------------------------

alter table public.ibnfaris_guest_usage enable row level security;
alter table public.ibnfaris_daily_totals enable row level security;
alter table public.ibnfaris_usage_log enable row level security;

revoke all on public.ibnfaris_guest_usage from public, anon, authenticated;
revoke all on public.ibnfaris_daily_totals from public, anon, authenticated;
revoke all on public.ibnfaris_usage_log from public, anon, authenticated;

grant select, insert, update, delete on public.ibnfaris_guest_usage to service_role;
grant select, insert, update, delete on public.ibnfaris_daily_totals to service_role;
grant select, insert, update, delete on public.ibnfaris_usage_log to service_role;
grant usage, select on sequence public.ibnfaris_usage_log_id_seq to service_role;

-- ------------------------------------------------------------
-- 3. حجز طلب بشكل ذري قبل استدعاء DeepSeek
-- ------------------------------------------------------------

create or replace function public.ibnfaris_reserve_request(
  p_visitor_hash text,
  p_visitor_limit integer,
  p_global_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_guest public.ibnfaris_guest_usage%rowtype;
  v_total public.ibnfaris_daily_totals%rowtype;
  v_allowed boolean := false;
  v_reason text := null;
  v_visitor_limit integer := greatest(coalesce(p_visitor_limit, 0), 0);
  v_global_limit integer := greatest(coalesce(p_global_limit, 0), 0);
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    raise exception 'invalid visitor hash';
  end if;

  insert into public.ibnfaris_daily_totals (usage_day)
  values (v_today)
  on conflict (usage_day) do nothing;

  select * into v_total
  from public.ibnfaris_daily_totals
  where usage_day = v_today
  for update;

  insert into public.ibnfaris_guest_usage (visitor_hash, usage_day)
  values (p_visitor_hash, v_today)
  on conflict (visitor_hash) do nothing;

  select * into v_guest
  from public.ibnfaris_guest_usage
  where visitor_hash = p_visitor_hash
  for update;

  if v_guest.usage_day <> v_today then
    v_guest.usage_day := v_today;
    v_guest.requests_used := 0;
    v_guest.prompt_tokens := 0;
    v_guest.completion_tokens := 0;
  end if;

  if v_global_limit <= 0 or v_total.requests_used >= v_global_limit then
    v_reason := 'global_limit';
  elsif v_visitor_limit <= 0 or v_guest.requests_used >= v_visitor_limit then
    v_reason := 'visitor_limit';
  else
    v_allowed := true;
    v_total.requests_used := v_total.requests_used + 1;
    v_guest.requests_used := v_guest.requests_used + 1;
  end if;

  update public.ibnfaris_daily_totals
  set requests_used = v_total.requests_used,
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set usage_day = v_guest.usage_day,
      requests_used = v_guest.requests_used,
      prompt_tokens = v_guest.prompt_tokens,
      completion_tokens = v_guest.completion_tokens,
      updated_at = now()
  where visitor_hash = p_visitor_hash;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'used', v_guest.requests_used,
    'limit', v_visitor_limit,
    'remaining', greatest(v_visitor_limit - v_guest.requests_used, 0),
    'global_used', v_total.requests_used,
    'global_limit', v_global_limit,
    'reset_on', to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

comment on function public.ibnfaris_reserve_request(text, integer, integer) is
  'يحجز طلباً واحداً للزائر ويطبّق الحد اليومي الفردي والسقف العام بشكل ذري.';

-- ------------------------------------------------------------
-- 4. إعادة الحجز عند فشل الطلب قبل وصول أي إجابة
-- ------------------------------------------------------------

create or replace function public.ibnfaris_release_request(p_visitor_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    return;
  end if;

  update public.ibnfaris_daily_totals
  set requests_used = greatest(requests_used - 1, 0),
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set requests_used = greatest(requests_used - 1, 0),
      updated_at = now()
  where visitor_hash = p_visitor_hash
    and usage_day = v_today;
end;
$$;

comment on function public.ibnfaris_release_request(text) is
  'يُعيد طلباً محجوزاً إذا فشل الاتصال بـ DeepSeek قبل بث أي إجابة.';

-- ------------------------------------------------------------
-- 5. تسجيل الاستهلاك بعد اكتمال الطلب
-- ------------------------------------------------------------

create or replace function public.ibnfaris_record_usage(
  p_visitor_hash text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_prompt integer := greatest(coalesce(p_prompt_tokens, 0), 0);
  v_completion integer := greatest(coalesce(p_completion_tokens, 0), 0);
  v_model text := left(coalesce(nullif(btrim(p_model), ''), 'deepseek-flash'), 120);
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    return;
  end if;

  insert into public.ibnfaris_usage_log (
    visitor_hash,
    model,
    prompt_tokens,
    completion_tokens
  )
  values (p_visitor_hash, v_model, v_prompt, v_completion);

  update public.ibnfaris_daily_totals
  set prompt_tokens = prompt_tokens + v_prompt,
      completion_tokens = completion_tokens + v_completion,
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set prompt_tokens = prompt_tokens + v_prompt,
      completion_tokens = completion_tokens + v_completion,
      updated_at = now()
  where visitor_hash = p_visitor_hash
    and usage_day = v_today;
end;
$$;

comment on function public.ibnfaris_record_usage(text, text, integer, integer) is
  'يسجّل التوكنات المستهلكة في الطلب، بلا حفظ لنص السؤال أو الإجابة.';

-- ------------------------------------------------------------
-- 5.1 نسخة الميزانية بالدولار: حجز تقديري ثم تسوية فعلية
-- ------------------------------------------------------------

create or replace function public.ibnfaris_reserve_request_v2(
  p_visitor_hash text,
  p_visitor_limit integer,
  p_global_limit integer,
  p_global_budget_usd numeric,
  p_estimated_cost_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_guest public.ibnfaris_guest_usage%rowtype;
  v_total public.ibnfaris_daily_totals%rowtype;
  v_allowed boolean := false;
  v_reason text := null;
  v_visitor_limit integer := greatest(coalesce(p_visitor_limit, 0), 0);
  v_global_limit integer := greatest(coalesce(p_global_limit, 0), 0);
  v_budget numeric := greatest(coalesce(p_global_budget_usd, 0), 0);
  v_estimate numeric := greatest(coalesce(p_estimated_cost_usd, 0), 0);
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    raise exception 'invalid visitor hash';
  end if;

  insert into public.ibnfaris_daily_totals (usage_day)
  values (v_today)
  on conflict (usage_day) do nothing;

  select * into v_total
  from public.ibnfaris_daily_totals
  where usage_day = v_today
  for update;

  insert into public.ibnfaris_guest_usage (visitor_hash, usage_day)
  values (p_visitor_hash, v_today)
  on conflict (visitor_hash) do nothing;

  select * into v_guest
  from public.ibnfaris_guest_usage
  where visitor_hash = p_visitor_hash
  for update;

  if v_guest.usage_day <> v_today then
    v_guest.usage_day := v_today;
    v_guest.requests_used := 0;
    v_guest.prompt_tokens := 0;
    v_guest.completion_tokens := 0;
  end if;

  if v_global_limit <= 0 or v_total.requests_used >= v_global_limit then
    v_reason := 'global_limit';
  elsif v_budget > 0 and (v_total.cost_usd + v_estimate) > v_budget then
    v_reason := 'global_budget';
  elsif v_visitor_limit <= 0 or v_guest.requests_used >= v_visitor_limit then
    v_reason := 'visitor_limit';
  else
    v_allowed := true;
    v_total.requests_used := v_total.requests_used + 1;
    v_total.cost_usd := v_total.cost_usd + v_estimate;
    v_guest.requests_used := v_guest.requests_used + 1;
  end if;

  update public.ibnfaris_daily_totals
  set requests_used = v_total.requests_used,
      cost_usd = v_total.cost_usd,
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set usage_day = v_guest.usage_day,
      requests_used = v_guest.requests_used,
      prompt_tokens = v_guest.prompt_tokens,
      completion_tokens = v_guest.completion_tokens,
      updated_at = now()
  where visitor_hash = p_visitor_hash;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'used', v_guest.requests_used,
    'limit', v_visitor_limit,
    'remaining', greatest(v_visitor_limit - v_guest.requests_used, 0),
    'global_used', v_total.requests_used,
    'global_limit', v_global_limit,
    'global_cost_usd', v_total.cost_usd,
    'global_budget_usd', v_budget,
    'global_remaining_usd', greatest(v_budget - v_total.cost_usd, 0),
    'reset_on', to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

comment on function public.ibnfaris_reserve_request_v2(text, integer, integer, numeric, numeric) is
  'يحجز طلباً واحداً ويطبّق الحد الفردي والسقف العام وميزانية DeepSeek اليومية بالدولار.';

create or replace function public.ibnfaris_release_request_v2(
  p_visitor_hash text,
  p_reserved_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_reserved numeric := greatest(coalesce(p_reserved_cost_usd, 0), 0);
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    return;
  end if;

  update public.ibnfaris_daily_totals
  set requests_used = greatest(requests_used - 1, 0),
      cost_usd = greatest(cost_usd - v_reserved, 0),
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set requests_used = greatest(requests_used - 1, 0),
      updated_at = now()
  where visitor_hash = p_visitor_hash
    and usage_day = v_today;
end;
$$;

comment on function public.ibnfaris_release_request_v2(text, numeric) is
  'يُعيد طلباً محجوزاً ويكشف الحجز التقديري من ميزانية اليوم.';

create or replace function public.ibnfaris_record_usage_v2(
  p_visitor_hash text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_reserved_cost_usd numeric,
  p_actual_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_prompt integer := greatest(coalesce(p_prompt_tokens, 0), 0);
  v_completion integer := greatest(coalesce(p_completion_tokens, 0), 0);
  v_reserved numeric := greatest(coalesce(p_reserved_cost_usd, 0), 0);
  v_actual numeric := greatest(coalesce(p_actual_cost_usd, 0), 0);
  v_model text := left(coalesce(nullif(btrim(p_model), ''), 'deepseek-flash'), 120);
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    return;
  end if;

  insert into public.ibnfaris_usage_log (
    visitor_hash,
    model,
    prompt_tokens,
    completion_tokens,
    cost_usd
  )
  values (p_visitor_hash, v_model, v_prompt, v_completion, v_actual);

  update public.ibnfaris_daily_totals
  set prompt_tokens = prompt_tokens + v_prompt,
      completion_tokens = completion_tokens + v_completion,
      cost_usd = greatest(cost_usd - v_reserved + v_actual, 0),
      updated_at = now()
  where usage_day = v_today;

  update public.ibnfaris_guest_usage
  set prompt_tokens = prompt_tokens + v_prompt,
      completion_tokens = completion_tokens + v_completion,
      updated_at = now()
  where visitor_hash = p_visitor_hash
    and usage_day = v_today;
end;
$$;

comment on function public.ibnfaris_record_usage_v2(text, text, integer, integer, numeric, numeric) is
  'يسجّل التوكنات والتكلفة الفعلية ويستبدل الحجز التقديري في ميزانية اليوم.';

-- ------------------------------------------------------------
-- 6. الصلاحيات: الخادم فقط
-- ------------------------------------------------------------

revoke all on function public.ibnfaris_reserve_request(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_release_request(text)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_record_usage(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_reserve_request_v2(text, integer, integer, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_release_request_v2(text, numeric)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_record_usage_v2(text, text, integer, integer, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.ibnfaris_reserve_request(text, integer, integer)
  to service_role;
grant execute on function public.ibnfaris_release_request(text)
  to service_role;
grant execute on function public.ibnfaris_record_usage(text, text, integer, integer)
  to service_role;
grant execute on function public.ibnfaris_reserve_request_v2(text, integer, integer, numeric, numeric)
  to service_role;
grant execute on function public.ibnfaris_release_request_v2(text, numeric)
  to service_role;
grant execute on function public.ibnfaris_record_usage_v2(text, text, integer, integer, numeric, numeric)
  to service_role;

notify pgrst, 'reload schema';
