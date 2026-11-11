# RUNBOOK.md — Sefay V1.02 Disaster Recovery

## 1. Database Recovery (Supabase)

### الوصول للـ Backups
1. افتح: https://supabase.com/dashboard/project/_/database/backups
2. اختر التاريخ المطلوب
3. اضغط "Restore"

### Point-in-Time Recovery (PITR)
متاح على Supabase Pro فقط.
يسمح بالاسترجاع لأي لحظة خلال 7 أيام (أو أكثر حسب الخطة).

### Manual Export (احتياطي يدوي)
pg_dump "postgresql://[user]:[password]@[host]:5432/postgres" --no-owner --no-acl -F c -f backup_$(date +%Y%m%d_%H%M%S).dump

### Manual Import
pg_restore -d "postgresql://[user]:[password]@[host]:5432/postgres" --no-owner --no-acl backup_YYYYMMDD_HHMMSS.dump

---

## 2. Redis Recovery

Redis (BullMQ) لا يحتوي بيانات دائمة — فقط job queues.
عند فقدان Redis:
1. أعد تشغيل Redis container / Railway Redis
2. الـ jobs المعلقة ستُعاد من Dunning retry logic
3. Notifications المفقودة لا تُسترجع — acceptable loss

---

## 3. API Recovery (Railway)

### إعادة Deploy
1. افتح Railway dashboard
2. اختر آخر successful deployment
3. اضغط "Redeploy"

### Environment Variables المطلوبة
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
REDIS_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
PAYMENT_PROVIDER=stripe
NODE_ENV=production

### التحقق بعد الاسترجاع
GET /api/v1/superadmin/health        ← تحقق من كل المكونات
GET /api/v1/superadmin/backup/status ← تحقق من DB + Redis
GET /api/v1/metrics                  ← تحقق من الـ metrics

---

## 4. Frontend Recovery (Vercel)

1. افتح Vercel dashboard
2. اختر آخر successful deployment
3. اضغط "Promote to Production"

---

## 5. RTO / RPO Targets

| المعيار | الهدف |
|---|---|
| RTO (Recovery Time Objective) | < 1 ساعة |
| RPO (Recovery Point Objective) | < 24 ساعة (Supabase daily backup) |
| PITR RPO (Pro Plan) | < 5 دقائق |

---

## 6. Incident Response Steps

1. تحديد المشكلة — استخدم /api/v1/superadmin/health
2. تقييم الأثر — كم tenant متضرر؟
3. إشعار — أبلغ المستخدمين إذا downtime > 15 دقيقة
4. الاسترجاع — اتبع الخطوات أعلاه حسب المكوّن
5. التحقق — /api/v1/superadmin/backup/status
6. Post-mortem — وثّق المشكلة والحل في audit_logs

---

## 7. Contacts & Status Pages

| المسؤولية | الرابط |
|---|---|
| Supabase Status | https://status.supabase.com |
| Railway Status | https://status.railway.app |
| Vercel Status | https://www.vercel-status.com |
| Stripe Status | https://status.stripe.com |
---

## 5. Secret Rotation Procedures

### 5.1 JWT_SECRET Rotation
**متى:** كل 90 يوم أو عند الاشتباه بتسريب.
**الأثر:** جميع sessions النشطة ستنتهي — المستخدمون يحتاجون إعادة تسجيل دخول.

**الخطوات:**
1. توليد secret جديد: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
2. في Railway Variables: حدّث `JWT_SECRET` بالقيمة الجديدة
3. Railway سيعيد تشغيل الـ service تلقائياً
4. راقب `/api/v1/metrics` و logs للتأكد من عدم وجود errors

**Rollback:** استرجع القيمة القديمة من Railway Variables history.

---

### 5.2 SUPABASE_SERVICE_ROLE_KEY Rotation
**متى:** كل 90 يوم أو عند الاشتباه بتسريب.
**الأثر:** الـ API يتوقف عن العمل حتى يُحدَّث المتغير.

**الخطوات:**
1. في Supabase Dashboard → Settings → API → Regenerate service_role key
2. **لا تحفظ** حتى تكون جاهزاً للتحديث الفوري
3. في Railway Variables: حدّث `SUPABASE_SERVICE_ROLE_KEY` فوراً
4. اضغط Regenerate في Supabase
5. Railway يعيد التشغيل تلقائياً
6. اختبر `GET /api/v1/superadmin/health/db`

**Rollback:** مستحيل — لا يمكن استرجاع المفتاح القديم بعد التجديد. تأكد من الخطوات قبل البدء.

---

### 5.3 STRIPE_SECRET_KEY Rotation
**متى:** كل 90 يوم أو عند الاشتباه بتسريب.
**الأثر:** الدفعات الجديدة ستفشل خلال فترة التحديث.

**الخطوات:**
1. Stripe Dashboard → Developers → API Keys → Roll key
2. Stripe يُبقي المفتاح القديم نشطاً لفترة قصيرة
3. في Railway Variables: حدّث `STRIPE_SECRET_KEY` بالمفتاح الجديد
4. اختبر دفعة تجريبية
5. في Stripe: أنهِ (revoke) المفتاح القديم

---

### 5.4 RESEND_API_KEY Rotation
**متى:** كل 90 يوم.
**الأثر:** الإيميلات ستفشل خلال فترة التحديث (mock mode يعمل كـ fallback).

**الخطوات:**
1. Resend Dashboard → API Keys → Create new key
2. في Railway Variables: حدّث `RESEND_API_KEY`
3. احذف المفتاح القديم من Resend Dashboard
4. اختبر إرسال إيميل تجريبي

---

## 8. Go-Live Safety Plan & Lessons Learned (2026-11-11)

### 8.1 ما حدث (ملخص للتذكّر)
| الحادثة | السبب الجذري | ما غيّرناه |
|---|---|---|
| الـAPI توقف على Railway | اشتراك Hobby أُلغي لعدم الدفع (21 أكتوبر) — دفع الفاتورة المتأخرة لا يعيد تفعيله؛ يجب إعادة الاشتراك من Plans | تجديد من لوحة Railway، وتذكير بتاريخ التجديد (أ.4 من كل شهر) |
| «Internal server error» في الدفع | الكود المنشور (15 أغسطس) أقدم من مخطط القاعدة (migrations حتى 257) | نشر الفرع الحالي؛ القاعدة والكود يُنشران معًا |
| «Branch not found or does not belong to tenant» | الويب أرسل أول فرع من قائمة غير مفلترة = فرع اختبار غير نشط | حذف ناعم للفرع التجريبي؛ نشر ويب يطلب `active_only=true` |
| 429 Too Many Requests + طلبات متكررة | كتالوج منشأة العرض 8,321 صنف اختبار (84 طلبًا لكل تحميل) | حذف ناعم لأصناف الاختبار التي لم تُبَع (نسخة احتياطية في `docs/backups/`) |
| بيانات اختبار في قاعدة الإنتاج | اختبارات Jest DB-backed كانت تعمل على قاعدة `.env` الحقيقية | `npm test` = وحدة فقط؛ `test:integration` محروس ولا يعمل إلا على قاعدة محلية/مخصصة |

### 8.2 قبل الإطلاق للعملاء (قائمة فحص)
- [ ] قاعدة **staging منفصلة** عن الإنتاج (لا مشاركة قاعدة).
- [ ] نسخ احتياطي تلقائي + PITR مفعّلان في Supabase، واختبار استعادة واحدة على الأقل.
- [ ] مراقبة التشغيل (UptimeRobot/BetterStack) على عنوان الـAPI مع إشعار للجوال.
- [ ] تتبّع أخطاء (Sentry أو مثله) للـAPI والويب.
- [ ] بوابة دفع حقيقية (`PAYMENT_PROVIDER=stripe`) إن كان هناك اشتراكات. `mock` للتجربة فقط ويتطلب `ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true`.
- [ ] لا حسابات ولا بيانات اختبار داخل منشآت العملاء. حساب العرض (Demo) في منشأة منفصلة.
- [ ] بطاقة الدفع في Railway/Vercel/Supabase سارية، وإشعارات الفواتير مفعّلة.
- [ ] تنبيهات الاستهلاك (Usage) في Railway وSupabase.
- [ ] كل migration تُنشر **مع كودها** في إصدار واحد، وبعد تجربتها على قاعدة غير الإنتاج.

### 8.3 قواعد دائمة
1. **لا اختبارات على قاعدة الإنتاج أبدًا.** `npm test` للوحدة، و`npm run test-db:up` ثم `npm run test:integration:local` للقاعدة المحلية (Docker).
2. **لا حذف فعلي للبيانات.** استخدم الحذف الناعم (`deleted_at`) مع نسخة احتياطية للمعرّفات قبل أي تنظيف.
3. migrations الجديدة تبدأ في `src/database/migrations_pending/` ولا تُنقل إلى `migrations/` إلا بعد تجربتها على قاعدة معزولة (لأن `start:prod` يطبّق كل ما في `migrations/` تلقائيًا).
4. استثناء منشأة QA/Demo في الإنتاج (حد الطلبات/الصلاحيات) مغلق افتراضيًا؛ يُفتح فقط بـ`ALLOW_QA_EXEMPTION_IN_PRODUCTION=true` عن قصد.

### 8.4 دليل الطوارئ (بالترتيب)
**الأعراض: «الخدمة لا تعمل» أو «Internal server error» للجميع**
1. افتح Railway ← `sefay-api` ← Deployments. الحالة Crashed؟ اقرأ **Deploy Logs** (أول سطر خطأ).
2. شريط *Limited Access / trial expired*؟ ← اشتراك الحساب (Billing ← Plans ← Deploy with Hobby) ثم Redeploy لـRedis ثم الـAPI.
3. فشل بعد نشر جديد؟ **ارجع فورًا** للنشر السابق: Railway ← نشر سابق سليم ← Redeploy، وVercel ← Deployments ← Promote to Production لنشر سابق. أصلح لاحقًا بهدوء.
4. متغيرات البيئة: `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `SUPABASE_ACCESS_TOKEN`، `JWT_SECRET`، `REDIS_URL`، `PAYMENT_PROVIDER` (+ مفاتيح Stripe أو `ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true`).
5. تحقق: `GET /` على الـAPI يعيد 200، ثم تسجيل دخول وبيع تجريبي واحد.

**الأعراض: خطأ فرع («Branch not found…») أو 403 على كل الطلبات**
- تحقق أن للمنشأة فرعًا **نشطًا غير محذوف** وأن الوردية على فرع صالح. أي فرع تجريبي غير نشط يُحذف حذفًا ناعمًا ولا يُترك في القائمة.

**الأعراض: 429 متكرر**
- افحص عدد الطلبات لكل تحميل (الكتالوج يُحمَّل صفحةً صفحة). منشأة بآلاف الأصناف ← نظّف أو حوّل التحميل إلى بحث من السيرفر. المخرج المؤقت: `ALLOW_QA_EXEMPTION_IN_PRODUCTION=true` لمنشأة العرض فقط.

**الأعراض: بيانات عميل تأثرت**
- لا تحذف. خذ لقطة/نسخة، وراجع سجل التدقيق، واستعد عبر الحذف الناعم أو PITR (قسم 1). وثّق الحادثة هنا.

### 8.5 ما بعد أي حادثة
اكتب سطرًا في جدول 8.1: ما حدث، السبب الجذري، وما غيّرناه. وإن تكرر نوع الحادثة، أضف فحصًا آليًا بدل الاعتماد على الذاكرة.
