-- ============================================================
-- إرجاع جميع مستخدمي «ابن فارس» إلى السقف الافتراضي (15 رسالة/يوم)
-- وإنشاء قسيمتين ترفعان السقف إلى 40 رسالة.
-- ============================================================
-- يُشغَّل مرة واحدة من Supabase SQL Editor.
--
-- ماذا يفعل؟
--   1. يعرض ثم يحذف كل صفوف السقف المخصص (ibnfaris_visitor_limits)،
--      فيعود كل مستخدم إلى الحد الافتراضي في أسرار الدالة (15 بعد
--      نشر التحديث).
--   2. ينشئ قسيمتين عشوائيتين، كل واحدة +25 رسالة (15 + 25 = 40)،
--      بلا تاريخ انتهاء. كل رمز يُستخدم مرة واحدة فقط.
--
-- تحذير: الحذف يلغي أيضاً بونص القسائم التي استُبدلت سابقاً، لأنه مخزَّن
-- في الصف نفسه. القسائم غير المستخدمة في ibnfaris_vouchers لا تتأثر.
-- ============================================================

-- 1) الأسقف المخصصة الحالية (احتفظ بالنتيجة إن أردت معرفة المتأثرين)
select visitor_hash, daily_limit, note, updated_at
from public.ibnfaris_visitor_limits
order by updated_at desc;

-- 2) إرجاع الجميع إلى الافتراضي
delete from public.ibnfaris_visitor_limits;

select count(*) as custom_limits_remaining
from public.ibnfaris_visitor_limits;

-- 3) إنشاء القسيمتين (عدّل العدد أو الزيادة عند الحاجة)
select * from public.ibnfaris_create_vouchers(
  2,
  25,
  null,
  'قسيمة رفع السقف إلى 40 رسالة'
);

-- للتأكد لاحقاً:
-- select code, bonus_limit, expires_at, used_by, used_at, note
-- from public.ibnfaris_vouchers
-- order by created_at desc
-- limit 10;
