# سجل التعديلات — هذه الجلسة

> جميع التعديلات محلية فقط — لم تُرفع لـ GitHub

---

## 1. حذف الكود الميت — Auth

**الملف المحذوف:** `src/core/auth/jwt.strategy.ts`
- كانت `JwtStrategy` (Passport) موجودة لكن لا أحد يستدعيها
- النظام يستخدم `jsonwebtoken.verify()` مباشرة في `JwtAuthGuard`

**الملف المعدّل:** `src/core/auth/auth.module.ts`
- حُذف `PassportModule` و `JwtStrategy` من الـ imports والـ providers

---

## 2. إصلاح N+1 Queries

### `src/modules/invoices/repositories/invoices.repository.ts`
- **قبل:** كل فاتورة = طلبان DB إضافيان (اسم الكاشير + اسم العميل)
- **بعد:** FK embedding في select واحد
  ```
  cashier:users!orders_cashier_id_fkey(name)
  customer:customers!orders_customer_id_fkey(full_name)
  ```

### `src/modules/auth/auth.service.ts` — `getSessions()`
- **قبل:** N جلسة = 2N طلب DB (user + tenant لكل جلسة)
- **بعد:** طلب واحد مع FK embedding

---

## 3. إصلاح Full Table Scans

### `src/modules/customers/customers.repository.ts` — `getGlobalStats()`
- **قبل:** جلب كل صفوف العملاء وعدّها في JavaScript
- **بعد:** طلبان `{ count: 'exact', head: true }` بشكل متوازٍ — صفر نقل بيانات

### `src/modules/customers/customers.repository.ts` — `getStats()`
- **قبل:** جلب كل أوردرات العميل وحساب المجموع في JavaScript
- **بعد:** COUNT query + `rpc('customer_order_aggregates')` للمجموع

### `src/modules/shared/analytics/platform-analytics.repository.ts` — `getGlobalStats()`
- **قبل:** جلب كل صفوف `orders` المكتملة لحساب المجموع في JavaScript
- **بعد:** `rpc('sum_completed_orders_revenue')` — حساب في DB

### `src/modules/shared/analytics/platform-analytics.repository.ts` — `getUsageAnalytics()`
- **قبل:** 5 queries لكل مستأجر داخل loop (100 tenant = 500 query)
- **بعد:** `rpc('get_tenant_usage_analytics')` — طلب واحد

---

## 4. إضافة Pagination للـ Expenses

**الملف:** `src/modules/expenses/expenses.service.ts`
- **قبل:** `findAll()` يرجع كل الصفوف بدون حد
- **بعد:** يقبل `PaginationDto` ويرجع `{ data, total, page, perPage }`

**الملف:** `src/modules/expenses/expenses.controller.ts`
- أضيف `?page=&per_page=` كـ query params

---

## 5. إصلاح ثغرة عزل المستأجرين في `revokeSession()`

**الملف:** `src/modules/auth/auth.service.ts`
- **قبل:** البحث عن الجلسة بـ `session_id` فقط — أي مستخدم يعرف UUID يقدر يلغي جلسة مستأجر آخر
- **بعد:** إضافة `.eq('tenant_id', tenantId)` لغير السوبر أدمن

---

## 6. استبدال `console.error` بـ Logger

| الملف | السطور |
|---|---|
| `src/modules/expenses/expenses.service.ts` | 281، 300، 348، 362 |
| `src/modules/branches/branches.repository.ts` | 61 |
| `src/core/audit/audit.service.ts` | 30 |
| `src/core/audit/audit.interceptor.ts` | 61 |
| `src/core/cache/redis-cache.module.ts` | 19 |

كل هذه الأماكن تستخدم الآن `Logger` من `@nestjs/common`.

---

## 7. Rate Limiting مخصص لـ `/auth`

**الملف:** `src/core/security/throttler.config.ts`
- أُضيف throttler ثانٍ: `{ name: 'auth', ttl: 60000, limit: 10 }`

**الملف:** `src/modules/auth/auth.controller.ts`
- أُضيف `@Throttle({ auth: { limit: 10, ttl: 60000 } })` على مستوى الـ Controller

---

## 8. طبقة تتبع AI (جديدة)

### الملفات الجديدة:
- `src/core/ai-usage/ai-usage-tracking.service.ts`
- `src/core/ai-usage/ai-usage-tracking.module.ts`
- `src/core/ai-usage/ai-usage-tracking.controller.ts`

### ما تفعله:
- تسجّل بداية / نجاح / فشل كل AI job
- تخزّن إحصائيات في Redis (fire-and-forget — لا تعيق الجلسة)
- Endpoint داخلي: `GET /internal/ai-usage?tenant_id=X`

### Redis key layout:
```
ai_usage:tenants                          — SET: كل المستأجرين المتتبَّعين
ai_usage:tenant:<id>:jobs                 — SET: أنواع الـ jobs لهذا المستأجر
ai_usage:tenant:<id>:job:<type>           — HASH: count, failCount, totalDurationMs, tokens
```

---

## 9. Queue AI معزول

**الملف:** `src/core/queue/processors/ai.processor.ts`
- Concurrency محدود بـ 3 (لا يتعارض مع باقي الـ queues)
- `AiJobData` يُطبّق `tenant_id` على مستوى TypeScript
- مربوط بـ `AiUsageTrackingService` لتسجيل كل job

---

## 10. Migrations جديدة

| الملف | المحتوى |
|---|---|
| `037_query_performance_indexes.sql` | Indexes على orders، customers، device_sessions، stock_levels، stock_movements |
| `038_analytics_aggregate_rpcs.sql` | 3 RPCs: `sum_completed_orders_revenue`، `get_tenant_usage_analytics`، `customer_order_aggregates` |

---

## الملفات المعدّلة — قائمة كاملة

```
src/app.module.ts
src/core/ai-usage/ai-usage-tracking.controller.ts     ← جديد
src/core/ai-usage/ai-usage-tracking.module.ts         ← جديد
src/core/ai-usage/ai-usage-tracking.service.ts        ← جديد
src/core/audit/audit.interceptor.ts
src/core/audit/audit.service.ts
src/core/auth/auth.module.ts
src/core/auth/jwt.strategy.ts                          ← محذوف
src/core/cache/redis-cache.module.ts
src/core/queue/processors/ai.processor.ts
src/core/queue/ai-queue.service.ts
src/core/queue/queue.module.ts
src/core/queue/queue.constants.ts
src/core/security/throttler.config.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.service.ts
src/modules/branches/branches.repository.ts
src/modules/customers/customers.repository.ts
src/modules/expenses/expenses.controller.ts
src/modules/expenses/expenses.service.ts
src/modules/invoices/repositories/invoices.repository.ts
src/modules/shared/analytics/platform-analytics.repository.ts
src/database/migrations/037_query_performance_indexes.sql  ← جديد
src/database/migrations/038_analytics_aggregate_rpcs.sql   ← جديد
```
