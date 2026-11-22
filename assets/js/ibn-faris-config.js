/* ============================================================
   إعدادات خدمة «ابن فارس» في روافد
   ============================================================
   Supabase URL ومفتاح anon عامّان بطبيعتهما ويُستخدمان في المتصفح.
   لا تضع هنا مفتاح service_role أو مفتاح DeepSeek إطلاقاً.

   الدوال المطلوبة على Supabase:
     functions/v1/ibn-faris-chat   (المحادثة)
     functions/v1/ibn-faris-admin  (لوحة /admin/)
   ============================================================ */
window.IBNAFARIS_CONFIG = {
  supabaseUrl: "https://veydmfljebzqwrolvuhe.supabase.co",
  supabaseAnonKey: "sb_publishable_oXDBwGE8QOVhj1sNsjK_rQ_hBva9IPm",
  functionName: "ibn-faris-chat",
  // لوحة التحكم: التحقق من الصلاحية يجري على الخادم في دالة
  // ibn-faris-admin، ولا يُعتمد على أي بريد مكتوب في المتصفح.
  adminFunctionName: "ibn-faris-admin",
  maxHistory: 12,
};
