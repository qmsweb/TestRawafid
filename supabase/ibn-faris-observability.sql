-- ============================================================
-- مراقبة استهلاك ابن فارس (اختياري)
-- ============================================================
-- شغّل هذا الملف مرة واحدة. لا يحتوي بيانات IP جديدة، ويعرض ملخصًا
-- يوميًا من جدول الإجماليات الموجود.
-- ============================================================

create or replace view public.ibnfaris_daily_metrics as
select
  usage_day,
  requests_used,
  prompt_tokens,
  completion_tokens,
  cost_usd,
  round(cost_usd / nullif(requests_used, 0), 6) as avg_cost_per_request
from public.ibnfaris_daily_totals;

comment on view public.ibnfaris_daily_metrics is
  'ملخص يومي لطلبات ابن فارس والتوكنات والتكلفة، للمراقبة فقط.';

revoke all on public.ibnfaris_daily_metrics from public, anon, authenticated;
grant select on public.ibnfaris_daily_metrics to service_role;

-- أعلى أيام الاستهلاك:
-- select * from public.ibnfaris_daily_metrics order by cost_usd desc limit 14;

-- متوسط التكلفة لكل طلب في آخر 30 يومًا:
-- select
--   round(avg(avg_cost_per_request), 6) as avg_cost,
--   sum(requests_used) as requests,
--   sum(cost_usd) as cost
-- from public.ibnfaris_daily_metrics
-- where usage_day >= current_date - interval '30 days';

notify pgrst, 'reload schema';
