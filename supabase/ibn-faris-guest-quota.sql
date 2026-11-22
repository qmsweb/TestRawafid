-- ============================================================
-- خدمة «ابن فارس» في روافد — حصص المستخدمين
-- ============================================================
-- الخدمة لا تعمل إلا لمستخدم مسجّل عبر Supabase Auth (Google).
-- مفتاح الحصة هو معرّف المستخدم الدائم (auth.users.id) بصيغة UUID،
-- وتُخزَّن في عمود visitor_hash التاريخي (36 حرفاً) دون أي بيانات شخصية
-- إضافية. لا يُستخدم عنوان IP ولا بصمة جهاز.
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
  'عدّاد استخدام خدمة ابن فارس لكل مستخدم مسجّل (auth.users.id) خلال اليوم.';
comment on column public.ibnfaris_guest_usage.visitor_hash is
  'معرّف المستخدم في Supabase Auth (UUID)؛ الاسم تاريخي فقط ولا يمثّل IP.';

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
-- 1.1 السقف اليومي المخصص والقسائم
-- ------------------------------------------------------------
-- لكل مستخدم (auth.users.id) سقف يومي افتراضي من أسرار الدالة،
-- ويمكن تخصيصه من Table Editor بإضافة صف هنا. وجود الصف يعني أن
-- السقف المخصص يتقدّم على الافتراضي، وحذفه يعيد المستخدم للافتراضي.
-- القسيمة تزيد هذا السقف زيادة دائمة (لا تنتهي بانتهاء اليوم).
create table if not exists public.ibnfaris_visitor_limits (
  visitor_hash text primary key check (char_length(visitor_hash) >= 32),
  daily_limit integer not null check (daily_limit >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ibnfaris_visitor_limits is
  'سقف يومي مخصص لكل مستخدم (auth.users.id)؛ يتقدّم على الحد الافتراضي في أسرار الدالة.';
comment on column public.ibnfaris_visitor_limits.daily_limit is
  'أقصى عدد أسئلة في اليوم لهذا المستخدم. القسائم تضيف إليه زيادة دائمة.';
comment on column public.ibnfaris_visitor_limits.note is
  'ملاحظة إدارية اختيارية لتمييز المستخدم (اسم أو سبب رفع الحد).';

-- قسائم لمرة واحدة: كل صف رمز من ست خانات يرفع سقف صاحبه زيادة دائمة.
create table if not exists public.ibnfaris_vouchers (
  code text primary key check (code ~ '^[0-9]{6}$'),
  bonus_limit integer not null check (bonus_limit > 0),
  note text,
  used_by text check (used_by is null or char_length(used_by) >= 32),
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.ibnfaris_vouchers is
  'قسائم لمرة واحدة ترفع السقف اليومي للمستخدم بمقدار bonus_limit زيادة دائمة.';
comment on column public.ibnfaris_vouchers.expires_at is
  'آخر موعد لاستخدام القسيمة؛ null تعني بلا انتهاء.';

-- نوع القسيمة: زيادة السقف فقط (الافتراضي)، أو زيادة + صفة «مشترك».
alter table public.ibnfaris_vouchers
  add column if not exists grants_subscription boolean not null default false;

comment on column public.ibnfaris_vouchers.grants_subscription is
  'true = القسيمة تمنح صاحبها صفة «مشترك» إضافة إلى رفع السقف اليومي.';

alter table public.ibnfaris_visitor_limits
  add column if not exists is_subscriber boolean not null default false;

comment on column public.ibnfaris_visitor_limits.is_subscriber is
  'true = المستخدم مشترك، وتظهر كلمة «مشترك» في إعداداته.';

create index if not exists ibnfaris_vouchers_used_by_idx
  on public.ibnfaris_vouchers (used_by, used_at desc);

-- عدّاد محاولات الاستبدال لمنع تخمين الرموز الستة.
create table if not exists public.ibnfaris_voucher_attempts (
  visitor_hash text not null check (char_length(visitor_hash) >= 32),
  attempt_day date not null default ((now() at time zone 'Asia/Muscat')::date),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  primary key (visitor_hash, attempt_day)
);

comment on table public.ibnfaris_voucher_attempts is
  'عدد محاولات استبدال القسائم لكل مستخدم في اليوم، لحماية الرموز من التخمين.';

-- ------------------------------------------------------------
-- 2. حماية الجداول: لا وصول مباشر من المتصفح
-- ------------------------------------------------------------

alter table public.ibnfaris_guest_usage enable row level security;
alter table public.ibnfaris_daily_totals enable row level security;
alter table public.ibnfaris_usage_log enable row level security;
alter table public.ibnfaris_visitor_limits enable row level security;
alter table public.ibnfaris_vouchers enable row level security;
alter table public.ibnfaris_voucher_attempts enable row level security;

revoke all on public.ibnfaris_guest_usage from public, anon, authenticated;
revoke all on public.ibnfaris_daily_totals from public, anon, authenticated;
revoke all on public.ibnfaris_usage_log from public, anon, authenticated;
revoke all on public.ibnfaris_visitor_limits from public, anon, authenticated;
revoke all on public.ibnfaris_vouchers from public, anon, authenticated;
revoke all on public.ibnfaris_voucher_attempts from public, anon, authenticated;

grant select, insert, update, delete on public.ibnfaris_guest_usage to service_role;
grant select, insert, update, delete on public.ibnfaris_daily_totals to service_role;
grant select, insert, update, delete on public.ibnfaris_usage_log to service_role;
grant select, insert, update, delete on public.ibnfaris_visitor_limits to service_role;
grant select, insert, update, delete on public.ibnfaris_vouchers to service_role;
grant select, insert, update, delete on public.ibnfaris_voucher_attempts to service_role;
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
  v_effective_limit integer := greatest(coalesce(p_visitor_limit, 0), 0);
  v_override integer;
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

  -- السقف المخصص من Table Editor يتقدّم على الافتراضي القادم من أسرار الدالة.
  if to_regclass('public.ibnfaris_visitor_limits') is not null then
    select daily_limit into v_override
    from public.ibnfaris_visitor_limits
    where visitor_hash = p_visitor_hash;

    if v_override is not null then
      v_effective_limit := greatest(v_override, 0);
    end if;
  end if;

  if v_global_limit <= 0 or v_total.requests_used >= v_global_limit then
    v_reason := 'global_limit';
  elsif v_budget > 0 and (v_total.cost_usd + v_estimate) > v_budget then
    v_reason := 'global_budget';
  elsif v_effective_limit <= 0 or v_guest.requests_used >= v_effective_limit then
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
    'limit', v_effective_limit,
    'remaining', greatest(v_effective_limit - v_guest.requests_used, 0),
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
  'يحجز طلباً واحداً ويطبّق السقف المخصص أو الافتراضي والسقف العام وميزانية DeepSeek اليومية.';

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
-- 5.2 القسائم: إنشاء رموز لمرة واحدة واستبدالها
-- ------------------------------------------------------------

-- إنشاء دفعة قسائم من SQL Editor:
--   العادية:      select * from public.ibnfaris_create_vouchers(10, 20);
--   مع اشتراك:    select * from public.ibnfaris_create_vouchers(10, 25, null, 'مشتركون', true);
-- p_count: عدد القسائم، p_bonus_limit: عدد الرسائل المضافة لكل قسيمة،
-- p_grants_subscription: true تمنح صاحبها صفة «مشترك» أيضاً.
drop function if exists public.ibnfaris_create_vouchers(integer, integer, timestamptz, text);

create or replace function public.ibnfaris_create_vouchers(
  p_count integer,
  p_bonus_limit integer,
  p_expires_at timestamptz default null,
  p_note text default null,
  p_grants_subscription boolean default false
)
returns table (
  voucher_code text,
  voucher_bonus integer,
  voucher_expires_at timestamptz,
  voucher_subscriber boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := least(greatest(coalesce(p_count, 1), 1), 500);
  v_bonus integer := greatest(coalesce(p_bonus_limit, 1), 1);
  v_subscriber boolean := coalesce(p_grants_subscription, false);
  v_code text;
  i integer;
begin
  for i in 1..v_count loop
    loop
      v_code := lpad((floor(random() * 1000000))::integer::text, 6, '0');
      exit when not exists (
        select 1 from public.ibnfaris_vouchers where code = v_code
      );
    end loop;

    insert into public.ibnfaris_vouchers (
      code,
      bonus_limit,
      note,
      expires_at,
      grants_subscription
    )
    values (v_code, v_bonus, p_note, p_expires_at, v_subscriber);

    voucher_code := v_code;
    voucher_bonus := v_bonus;
    voucher_expires_at := p_expires_at;
    voucher_subscriber := v_subscriber;
    return next;
  end loop;
end;
$$;

comment on function public.ibnfaris_create_vouchers(integer, integer, timestamptz, text, boolean) is
  'يولّد قسائم عشوائية من ست خانات ترفع السقف، وتمنح صفة «مشترك» عند طلب ذلك.';

-- استبدال قسيمة بشكل ذري: تُعلَّم مستخدمة، ويُرفع السقف، مع حد لمحاولات
-- التخمين اليومية. يعيد jsonb حتى تعرض الواجهة سبب الفشل بدقة.
create or replace function public.ibnfaris_redeem_voucher(
  p_visitor_hash text,
  p_code text,
  p_default_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_code text := translate(
    btrim(coalesce(p_code, '')),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );
  v_attempts integer;
  v_max_attempts constant integer := 15;
  v_voucher public.ibnfaris_vouchers%rowtype;
  v_new_limit integer;
  v_subscriber boolean := false;
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  delete from public.ibnfaris_voucher_attempts
  where visitor_hash = p_visitor_hash
    and attempt_day < v_today - 7;

  insert into public.ibnfaris_voucher_attempts (visitor_hash, attempt_day, attempts)
  values (p_visitor_hash, v_today, 1)
  on conflict (visitor_hash, attempt_day) do update
    set attempts = ibnfaris_voucher_attempts.attempts + 1,
        updated_at = now()
  returning attempts into v_attempts;

  if v_attempts > v_max_attempts then
    return jsonb_build_object(
      'ok', false,
      'reason', 'rate_limited',
      'max_attempts', v_max_attempts
    );
  end if;

  select * into v_voucher
  from public.ibnfaris_vouchers
  where code = v_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if v_voucher.used_by is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  if v_voucher.expires_at is not null and v_voucher.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  update public.ibnfaris_vouchers
  set used_by = p_visitor_hash,
      used_at = now()
  where code = v_voucher.code;

  insert into public.ibnfaris_visitor_limits (
    visitor_hash,
    daily_limit,
    is_subscriber
  )
  values (
    p_visitor_hash,
    greatest(coalesce(p_default_limit, 0), 0) + v_voucher.bonus_limit,
    v_voucher.grants_subscription
  )
  on conflict (visitor_hash) do update
    set daily_limit = greatest(ibnfaris_visitor_limits.daily_limit, 0)
      + v_voucher.bonus_limit,
        is_subscriber = ibnfaris_visitor_limits.is_subscriber
          or excluded.is_subscriber,
        updated_at = now()
  returning daily_limit, is_subscriber into v_new_limit, v_subscriber;

  -- نجاح الاستبدال يصفّر عدّاد المحاولات حتى لا يمنع قسائم أخرى مشروعة.
  update public.ibnfaris_voucher_attempts
  set attempts = 0,
      updated_at = now()
  where visitor_hash = p_visitor_hash
    and attempt_day = v_today;

  return jsonb_build_object(
    'ok', true,
    'bonus', v_voucher.bonus_limit,
    'limit', v_new_limit,
    'subscriber', v_subscriber,
    'reset_on', to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

comment on function public.ibnfaris_redeem_voucher(text, text, integer) is
  'يستبدل قسيمة مرة واحدة ويرفع السقف اليومي زيادة دائمة، وقد يمنح صفة «مشترك»، مع حد للمحاولات.';

-- عرض مساعد للإدارة: آخر استخدام ومعه السقف المخصص إن وُجد.
create or replace view public.ibnfaris_visitor_overview as
select
  g.visitor_hash,
  g.usage_day as last_usage_day,
  g.requests_used as requests_used_today,
  g.updated_at as last_seen_at,
  l.daily_limit as custom_daily_limit,
  l.note as admin_note,
  coalesce(l.is_subscriber, false) as is_subscriber
from public.ibnfaris_guest_usage g
left join public.ibnfaris_visitor_limits l using (visitor_hash);

comment on view public.ibnfaris_visitor_overview is
  'نظرة إدارية على المستخدمين: الاستخدام اليومي والسقف المخصص والملاحظة.';

-- عرض مساعد يربط معرّف المستخدم ببريده واسمه من Auth، ليبقى تخصيص
-- السقف من Table Editor ممكناً دون البحث اليدوي عن UUID.
create or replace view public.ibnfaris_user_overview as
select
  u.id as user_id,
  u.email,
  u.raw_user_meta_data ->> 'full_name' as full_name,
  g.usage_day as last_usage_day,
  case
    when g.usage_day = ((now() at time zone 'Asia/Muscat')::date)
      then g.requests_used
    else 0
  end as requests_used_today,
  g.updated_at as last_seen_at,
  l.daily_limit as custom_daily_limit,
  l.note as admin_note,
  coalesce(l.is_subscriber, false) as is_subscriber
from auth.users u
left join public.ibnfaris_guest_usage g on g.visitor_hash = u.id::text
left join public.ibnfaris_visitor_limits l on l.visitor_hash = u.id::text;

comment on view public.ibnfaris_user_overview is
  'نظرة إدارية على مستخدمي ابن فارس: البريد والاسم والاستخدام اليومي والسقف المخصص.';

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
revoke all on function public.ibnfaris_create_vouchers(integer, integer, timestamptz, text, boolean)
  from public, anon, authenticated;
revoke all on function public.ibnfaris_redeem_voucher(text, text, integer)
  from public, anon, authenticated;
revoke all on table public.ibnfaris_visitor_overview from public, anon, authenticated;
grant select on table public.ibnfaris_visitor_overview to service_role;
revoke all on table public.ibnfaris_user_overview from public, anon, authenticated;
grant select on table public.ibnfaris_user_overview to service_role;

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
grant execute on function public.ibnfaris_create_vouchers(integer, integer, timestamptz, text, boolean)
  to service_role;
grant execute on function public.ibnfaris_redeem_voucher(text, text, integer)
  to service_role;

notify pgrst, 'reload schema';
