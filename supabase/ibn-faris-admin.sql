-- ============================================================
-- خدمة «ابن فارس» في روافد — لوحة التحكم الإدارية
-- ============================================================
-- هذا الملف يضيف ما تحتاجه لوحة /admin/:
--   1. جدول إعدادات عامة (سقف الطلبات اليومي + الميزانية اليومية بالدولار)
--      تتقدّم قيمه على الأسرار IBNAFARIS_GLOBAL_DAILY_LIMIT
--      وIBNAFARIS_GLOBAL_DAILY_BUDGET_USD، ويقرأها نشر الدالة الجديد.
--   2. دالة ذرية لتصفير استهلاك حساب واحد في اليوم الحالي، تُستخدم عند
--      الحاجة إلى إلغاء حجب مستخدم دون انتظار منتصف الليل.
--
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor داخل مشروع ابن فارس.
-- الملف آمن للتشغيل المتكرر (idempotent)، ولا يحذف أي بيانات قائمة.
-- بعد تشغيله أعد نشر دالة ibn-faris-chat (لتقرأ الإعدادات) وانشر دالة
-- ibn-faris-admin الجديدة.
-- ============================================================

-- ------------------------------------------------------------
-- 1. إعدادات السقف العام
-- ------------------------------------------------------------
-- صف واحد فقط (id = 1). القيمة null تعني «استخدم القيمة الافتراضية من
-- أسرار الدالة»، حتى يبقى السلوك القديم إن لم يُضبط شيء من اللوحة.
create table if not exists public.ibnfaris_settings (
  id smallint primary key default 1 check (id = 1),
  global_daily_limit integer
    check (global_daily_limit is null or global_daily_limit >= 0),
  global_daily_budget_usd numeric(12, 6)
    check (global_daily_budget_usd is null or global_daily_budget_usd >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.ibnfaris_settings is
  'إعدادات لوحة تحكم ابن فارس: السقف العام اليومي لعدد الطلبات والميزانية اليومية بالدولار.';
comment on column public.ibnfaris_settings.global_daily_limit is
  'أقصى عدد طلبات لكل الخدمة في اليوم؛ null تعني استخدام IBNAFARIS_GLOBAL_DAILY_LIMIT.';
comment on column public.ibnfaris_settings.global_daily_budget_usd is
  'أقصى تكلفة يومية بالدولار؛ null تعني استخدام IBNAFARIS_GLOBAL_DAILY_BUDGET_USD، والصفر يعني بلا حد.';
comment on column public.ibnfaris_settings.updated_by is
  'بريد الحساب الإداري الذي أجرى آخر تعديل.';

insert into public.ibnfaris_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.ibnfaris_settings enable row level security;
revoke all on public.ibnfaris_settings from public, anon, authenticated;
grant select, insert, update, delete on public.ibnfaris_settings to service_role;

-- ------------------------------------------------------------
-- 2. تصفير استهلاك حساب واحد لليوم الحالي
-- ------------------------------------------------------------
-- يصفّر عدّاد المستخدم ويخصم استهلاكه من إجمالي اليوم نفسه، فلا تختل
-- أرقام السقف العام. يُستدعى من لوحة التحكم فقط عبر دالة الخادم.
create or replace function public.ibnfaris_admin_reset_user_usage(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_used integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_user');
  end if;

  select requests_used into v_used
  from public.ibnfaris_guest_usage
  where visitor_hash = p_user_id::text
    and usage_day = v_today
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'reset', 0);
  end if;

  update public.ibnfaris_guest_usage
  set requests_used = 0,
      updated_at = now()
  where visitor_hash = p_user_id::text
    and usage_day = v_today;

  update public.ibnfaris_daily_totals
  set requests_used = greatest(requests_used - v_used, 0),
      updated_at = now()
  where usage_day = v_today;

  return jsonb_build_object('ok', true, 'reset', v_used);
end;
$$;

comment on function public.ibnfaris_admin_reset_user_usage(uuid) is
  'يصفّر استهلاك مستخدم في اليوم الحالي ويخصمه من إجمالي اليوم (للوحة التحكم).';

revoke all on function public.ibnfaris_admin_reset_user_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.ibnfaris_admin_reset_user_usage(uuid)
  to service_role;

-- ------------------------------------------------------------
-- 3. تحديث مخطط PostgREST فوراً
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
