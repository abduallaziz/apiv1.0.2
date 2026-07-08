# Architecture — Sefay API

---

## نموذج المستأجرين (Multi-Tenancy)

كل طلب يمر بسلسلة guards:

```
Request
  → JwtAuthGuard        (يتحقق من JWT ويضع user في request)
  → TenantGuard         (يضع tenantId في context — null للسوبر أدمن)
  → PermissionGuard     (يتحقق من permission مرتبطة بالـ endpoint)
  → FeatureGuard        (يتحقق من أن المستأجر عنده هذه الميزة)
```

### عزل البيانات

- كل استعلام DB يضيف `.eq('tenant_id', tenantId)` تلقائياً
- `tenantId = null` مسموح فقط للـ **superadmin** (cross-tenant access مقصود)
- الـ `ScopedRepository` base class يضيف `.is('deleted_at', null)` تلقائياً (soft delete)

---

## Auth System

- **JWT فقط** — لا Passport، لا sessions على السيرفر
- Access token: قصير العمر (15 دقيقة افتراضياً)
- Refresh token: مخزون في DB (`refresh_tokens` table) + httpOnly cookie
- الجلسات مسجّلة في `device_sessions` (ليست في الذاكرة)
- التحقق: `jsonwebtoken.verify()` مباشرة في `JwtAuthGuard`

---

## Redis — الاستخدامات

| الغرض | المفتاح | الوحدة |
|---|---|---|
| Cache الصلاحيات | `permissions:tenant:{tenantId}:role:{role}` (أو `permissions:role:{role}` بلا مستأجر — راجع STATUS.md §68) | PermissionsService |
| Rate limiting | `rl:{name}:{tracker}` | RedisThrottlerStorage |
| قياس الأداء | `perf:*` | PerfTrackingService |
| تتبع AI | `ai_usage:*` | AiUsageTrackingService |
| BullMQ queues | `sefay:{queue}:*` | QueueModule |

**مهم:** يُستخدم `SCAN` دائماً بدلاً من `KEYS` لتجنب blocking.

---

## Queue System (BullMQ)

| Queue | الغرض | Concurrency |
|---|---|---|
| `ai` | معالجة مهام AI | 3 (محدود) |
| `dunning` | تحصيل الاشتراكات المتأخرة | افتراضي |
| `notifications` | إرسال الإشعارات | افتراضي |
| `domain-events` | أحداث النطاق | افتراضي |
| `audit-cleanup` | تنظيف سجلات القديمة | افتراضي |

### AI Queue

- كل job يجب أن يحتوي `tenant_id` (مُطبَّق على مستوى TypeScript)
- `AiProcessor` يسجّل: start / complete / fail عبر `AiUsageTrackingService`
- الكتابة لـ Redis fire-and-forget (لا تعيق إكمال الـ job)

---

## Pagination

كل endpoint يُرجع قائمة يستخدم `PaginationDto`:

```typescript
// Query params: ?page=1&per_page=50
class PaginationDto {
  page: number      // default: 1
  perPage: number   // default: 50, max: 100
  range: [number, number]  // لـ Supabase .range(from, to)
}
```

الرد يأتي بالشكل:
```json
{
  "data": [...],
  "total": 150,
  "page": 1,
  "perPage": 50
}
```

---

## Rate Limiting

| Throttler | الحد | النافذة | يطبّق على |
|---|---|---|---|
| `global` | 100 طلب | 60 ثانية | كل الـ endpoints |
| `auth` | 10 طلبات | 60 ثانية | `/auth/*` فقط |

- Tracker للـ auth routes: IP address
- Tracker للبقية: `tenant:{tenantId}`
- Storage: Redis (ليس in-memory)

---

## Logging

كل log يحتوي:
- `tenantId`
- `userId`
- `module` + `action`
- `meta` (بيانات إضافية)
- Stack trace عند الأخطاء

الـ `LoggerService` يُستخدم في كل الأماكن — لا `console.error` في production code.

---

## Outbox Pattern

الأحداث المهمة تُكتب أولاً في جدول `outbox_events` (نفس transaction البيانات)، ثم worker منفصل يرسلها للـ queues. يضمن عدم ضياع أي حدث حتى لو انقطع الاتصال بالـ queue.

---

## Supabase Client

- Singleton عبر `SupabaseModule` (`@Global`)
- يستخدم `service_role` key (bypass RLS) لأن tenant isolation تتم في الكود
- `fetch` wrapper يحسب عدد DB queries لكل request عبر `AsyncLocalStorage`

---

## Global Modules

هذه المودولز `@Global()` ومتاحة في كل مكان بدون import:

- `RedisCacheModule` — Redis client
- `CoreAuthModule` — JwtModule + JwtAuthGuard
- `MetricsModule` — مؤشرات الأداء
- `PerfTrackingModule` — قياس مدة الطلبات
- `AiUsageTrackingModule` — تتبع استخدام AI
- `LoggerModule` — نظام اللوج
