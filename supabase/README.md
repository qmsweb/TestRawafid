# خدمة «ابن فارس» في روافد

نسخة خفيفة من مساعد ابن فارس داخل منصة روافد:

- محادثة ذكية بنموذج **برق** (`deepseek-flash`).
- بلا حفظ للمحادثات، وبلا عروض تقديمية أو دفاتر أو مهارات.
- الواجهة بهوية ابن فارس الأصلية: Parchment / Ink / Sand.
- الزر العائم في صفحات روافد ينقل إلى `/ibn-faris/`.

بما أن روافد منشورة على GitHub Pages (موقع ثابت)، فإن مفتاح DeepSeek **لا يوضع في المتصفح**.
المتصفح يتصل بدالة Supabase Edge Function، وهي التي تحتفظ بالمفتاح وتطبّق الحصص.

```
المتصفح (GitHub Pages)
        │  POST + مفتاح anon العام
        ▼
Supabase Edge Function: ibn-faris-chat
        │  مفتاح DeepSeek السري
        ▼
DeepSeek API
        │
        └── Supabase Postgres: حصص الزوار + سجل توكنات مختصر
```

## ما الذي أُضيف إلى المشروع؟

| الملف | الوظيفة |
|---|---|
| `ibn-faris.html` | صفحة الخدمة على `/ibn-faris/` |
| `_layouts/ibn-faris.html` | قالب الصفحة |
| `_includes/ibn-faris-app.html` | واجهة المحادثة المشتركة (صفحة + لوحة عائمة) |
| `assets/css/ibn-faris.css` | هوية ابن فارس البصرية وتنسيق اللوحة السفلية |
| `assets/js/ibn-faris.js` | المحادثة والبثّ وMarkdown (قابل للتركيب على أي حاوية) |
| `assets/js/ibn-faris-widget.js` | فتح اللوحة السفلية فوق أي صفحة وتحميل الموارد عند الطلب |
| `assets/js/ibn-faris-config.js` | رابط Supabase والمفتاح العام |
| `_includes/ibn-faris-button.html` | الزر العائم + قالب اللوحة السفلية |
| `_includes/header.html` | يستدعي الزر في صفحات روافد |
| `supabase/ibn-faris-guest-quota.sql` | جداول ودوال الحصص |
| `supabase/functions/ibn-faris-chat/index.ts` | وسيط DeepSeek |

> المجلد `supabase/` مستبعد من نشر Jekyll في `_config.yml`، فلا يظهر في الموقع.

---

## خطوات التشغيل (مرة واحدة)

### 1. أنشئ جداول الحصص

افتح مشروع Supabase الخاص بابن فارس:

`https://supabase.com/dashboard/project/veydmfljebzqwrolvuhe/sql`

ثم افتح **SQL Editor**، والصق كامل محتوى:

`supabase/ibn-faris-guest-quota.sql`

وشغّله. الملف آمن إذا شُغّل أكثر من مرة.

### 2. أضف أسرار الدالة

من لوحة Supabase:

`Project Settings → Edge Functions → Secrets`

أضف:

| الاسم | القيمة |
|---|---|
| `DEEPSEEK_API_KEY` | مفتاح DeepSeek (من منصة DeepSeek أو من `C:\IbnFaris\.env.local`) |
| `IBNAFARIS_IP_SALT` | نص عشوائي طويل وثابت، مثل 32 حرفاً |

اختيارياً:

| الاسم | الافتراضي | الوظيفة |
|---|---|---|
| `IBNAFARIS_VISITOR_DAILY_LIMIT` | `40` | أقصى عدد أسئلة للزائر في اليوم |
| `IBNAFARIS_GLOBAL_DAILY_LIMIT` | `400` | سقف طلبات الخدمة كلها في اليوم |
| `IBNAFARIS_RAG_ENABLED` | `true` | الاستعانة بقاعدة معرفة `knowledge_chunks` إن وُجدت |
| `EMBEDDING_API_KEY` | فارغ | لتفعيل البحث المتجهي في RAG |
| `IBNAFARIS_ALLOWED_ORIGINS` | نطاقات روافد | مصادر CORS المسموحة، مفصولة بفاصلة |

> `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` يوفّرهما Supabase للدالة تلقائياً في
> المشاريع الحديثة. إن لم يظهرا، أضفهما يدوياً من `Project Settings → API` بنفس
> الأسماء. لا تضع `service_role` ولا `DEEPSEEK_API_KEY` في أي ملف داخل الموقع.
>
> إن كان `IBNAFARIS_VISITOR_DAILY_LIMIT` مضبوطاً في الأسرار فقيمته تتقدّم على
> الافتراضية؛ اضبطه على `40` أيضاً (أو احذفه ليعمل الافتراضي). وبعد أي تعديل على
> `supabase/functions/ibn-faris-chat/index.ts` أعد نشر الدالة.

### 3. انشر الدالة

**الطريقة الأسهل من لوحة Supabase:**

1. `Edge Functions → Create a new function`
2. الاسم: `ibn-faris-chat`
3. الصق محتوى `supabase/functions/ibn-faris-chat/index.ts`
4. اترك **Verify JWT** مفعّلاً (المتصفح يرسل مفتاح anon العام)
5. Deploy

**أو عبر Supabase CLI من جذر المشروع:**

```powershell
supabase login
supabase functions deploy ibn-faris-chat --project-ref veydmfljebzqwrolvuhe
```

### 4. تأكد من الإعدادات الأمامية

`assets/js/ibn-faris-config.js` يحتوي بالفعل على:

- `supabaseUrl`: `https://veydmfljebzqwrolvuhe.supabase.co`
- `supabaseAnonKey`: مفتاح anon العام للمشروع
- `functionName`: `ibn-faris-chat`

مفتاح anon **عام بطبيعته** ويُستخدم في المتصفح. الجداول محمية بـ RLS، ولا تُمنح
للمتصفح أي صلاحية عليها.

### 5. اختبر

افتح:

`https://rawafid.jassim.one/ibn-faris/`

أو محلياً:

```powershell
jekyll serve
# http://localhost:4000/ibn-faris/
```

جرّب سؤالاً، وتأكد من ظهور الرد تدريجياً، ومن ظهور «متبقٍ اليوم» أسفل المحادثة.

---

## كيف يعمل البثّ؟

الدالة تعيد SSE مبسّطاً:

```text
data: {"type":"quota","quota":{...}}
data: {"type":"answer","text":"..."}
data: {"type":"ungrounded","text":"..."}
data: {"type":"done"}
```

واجهة `ibn-faris.js` تقرأ `answer` وتضيفه إلى الرسالة، وتتعامل مع `error` و`quota`،
وإذا وصل `ungrounded` تستبدل نص الرد برفض مهذب. الشعر العمودي داخل كتلة ` ```poetry `
يُعرض في بطاقة شعرية، وبقية الرد يُعرض بـ Markdown آمن عبر `marked` + `DOMPurify`
(نسخ محلية داخل `assets/js/vendor/`).

## الاستناد إلى المصادر (منع الهلوسة)

- تُستخرج كلمات مفتاحية من السؤال، ثم تُسترجع المقاطع من `knowledge_chunks`
  (بحث كلماتي + تشابه حرفي `word_similarity`).
- **حَكَم المصادر**: استدعاء سريع لـ`deepseek-flash` يرفض المقاطع التي لا تعالج
  السؤال، فلا يُسأل النموذج إلا وعنده مادة.
- إن لم يوجد مقطع مناسب: يُعاد ردّ ثابت «لا أجد في المصادر المتاحة…» دون استدعاء
  النموذج، **ولا تُحتسب من الحصة اليومية**.
- إن وُجد: يُطلب من النموذج الإجابة من المقاطع حصراً، مع استشهاد `[رقم]` بعد كل حكم.
- إن خلا الرد من استشهاد صحيح: يُستبدل برفض مهذب (حدث `ungrounded`).
- لا يُسمح بذكر كتاب أو باب أو صفحة غير موجودة في المقاطع.

### قاعدة المصادر الحالية

- 15 كتاباً نحوياً ولغوياً من مشروع [OpenITI](https://openiti.org/) (نحو وصرف ولغة
  وبلاغة)، نحو **17,700 مقطع**.
- الترخيص: **CC BY-NC-SA 4.0**؛ يلزم ذكر المصدر، ويُمنع الاستخدام التجاري.
- الكتب: الكتاب لسيبويه، الخصائص لابن جني، الصاحبي ومعجم مقاييس اللغة لابن فارس،
  ألفية ابن مالك وشرح الكافية وتسهيل الفوائد، أوضح المسالك ومغني اللبيب وشرح قطر
  الندى وشرح شذور الذهب لابن هشام، شرح ابن عقيل، شرح الأشموني، همع الهوامع والمزهر
  للسيوطي.
- أدوات البناء في مشروع IbnFaris: `scripts/openiti-to-txt.mjs` ثم
  `scripts/books-to-jsonl.mjs` ثم `scripts/rag-ingest.mjs`.

## الحصص والخصوصية

- لا تُحفظ رسائل المستخدم ولا ردود المساعد في قاعدة البيانات.
- يُسجَّل فقط: بصمة IP مجزّأة، النموذج، عدد توكنات الإدخال والإخراج، والتاريخ.
- الحصة اليومية تُحسب بتوقيت مسقط، وتُصفَّر تلقائياً عند تغيّر اليوم.
- الحجز ذرّي في Postgres، فلا يمكن تجاوز الحد بطلبات متزامنة.
- عند فشل DeepSeek قبل بث أي إجابة، يُعاد الحجز تلقائياً.

## تغيير الشكل

- ألوان ابن فارس: أعلى `assets/css/ibn-faris.css` (نسختا light وdark).
- اللوحة السفلية: قسم «النافذة العائمة» في `assets/css/ibn-faris.css` (الانزلاق، الحجاب، الاستدارة).
- زر صفحات روافد: `_includes/ibn-faris-button.html` (اللون، الموضع، النص).
- نصوص الاقتراحات والحالة الفارغة: `_includes/ibn-faris-app.html`.
- الشريط العلوي وأزرار الإغلاق/الجديدة: `_includes/ibn-faris-app.html`.
- أحداث الفتح والإغلاق: `assets/js/ibn-faris-widget.js`.

## استكشاف الأخطاء

| العَرَض | السبب المحتمل | الحل |
|---|---|---|
| `404` عند الإرسال | الدالة لم تُنشر بعد | انشر `ibn-faris-chat` |
| `401 / 403` | مفتاح anon غير صحيح أو Origin غير مسموح | راجع `ibn-faris-config.js` و`IBNAFARIS_ALLOWED_ORIGINS` |
| `503` | `DEEPSEEK_API_KEY` غير مضاف | أضفه في Secrets ثم أعد النشر |
| `429` | بلغت الحصة اليومية | عد غداً أو ارفع الحد من Secrets |
| `500` | جداول الحصص غير موجودة | شغّل `ibn-faris-guest-quota.sql` |
| الرد يظهر دفعة واحدة | وسيط أو شبكة تمنع البثّ | تأكد أن الدالة تعيد `text/event-stream` |

## ملاحظات

- صفحات الاختبارات والمحرر لا تعرض الزر العائم (حماية للتقويم).
- لا يوجد بحث ويب في هذه النسخة، ولا اختيار «حكيم»؛ النموذج الوحيد هو برق.
- سياق المحادثة: آخر 12 رسالة، حتى 48,000 حرف (لا يُقطع السياق عملياً).
- سقف إخراج الرد: 2,500 توكن، ومهلة استرجاع قاعدة المعرفة: 5 ثوانٍ.
- لتعديل النطاقات المسموحة، حدّث `IBNAFARIS_ALLOWED_ORIGINS` وأعد نشر الدالة.
