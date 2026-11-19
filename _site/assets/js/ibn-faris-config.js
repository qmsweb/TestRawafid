/* ============================================================
   إعدادات خدمة «ابن فارس» في روافد
   ============================================================
   Supabase URL ومفتاح anon عامّان بطبيعتهما ويُستخدمان في المتصفح.
   لا تضع هنا مفتاح service_role أو مفتاح DeepSeek إطلاقاً.

   الدالة المطلوبة على Supabase:
     functions/v1/ibn-faris-chat
   ============================================================ */
window.IBNAFARIS_CONFIG = {
  supabaseUrl: "https://veydmfljebzqwrolvuhe.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZleWRtZmxqZWJ6cXdyb2x2dWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNTE4MjUsImV4cCI6MjEwNzcyNzgyNX0.7jFXUA2yHeQ_G4VBFWZfJyA5AFLe0LgqIsRSeWjEi6s",
  functionName: "ibn-faris-chat",
  maxHistory: 12,
};
