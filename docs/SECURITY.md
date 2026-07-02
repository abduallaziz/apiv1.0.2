# Security — Sefay API

---

## Auth Flow

```
1. POST /auth/login
   → Supabase يتحقق من email + password
   → ينشئ access_token (JWT, 15 دقيقة)
   → ينشئ refresh_token (مخزون في DB)
   → يحفظ device_session
   → يرسل refresh_token في httpOnly cookie

2. كل طلب مصادَق
   → Authorization: Bearer <access_token>
   → JwtAuthGuard يفك الـ JWT ويضع user في request

3. POST /auth/refresh
   → يقرأ sefay_refresh cookie
   → يتحقق من refresh_token في DB
   → يصدر access_token جديد

4. POST /auth/logout
   → يحذف الـ cookie
   → يُلغي device_session
   → يُلغي refresh_token
```

---

## Guards Chain

```
JwtAuthGuard
  ↓ يتحقق من JWT + يضع user في request
TenantGuard
  ↓ يقرأ X-Tenant-ID header + يتحقق من user.tenant_id
  ↓ superadmin: tenantId = null (cross-tenant مسموح)
PermissionGuard
  ↓ يتحقق من أن للمستخدم الصلاحية المطلوبة
  ↓ superadmin: bypass تلقائي
FeatureGuard (اختياري)
  ↓ يتحقق من أن المستأجر عنده هذه الميزة في خطته
```

---

## Roles

| الدور | الوصف |
|---|---|
| `superadmin` | وصول كامل cross-tenant، بدون X-Tenant-ID |
| `owner` | كامل الصلاحيات داخل المستأجر |
| `manager` | صلاحيات إدارية داخل الفرع |
| `cashier` | عمليات البيع والفواتير |
| `inventory` | إدارة المخزون |
| `accountant` | تقارير وحسابات |
| `viewer` | قراءة فقط |

---

## Rate Limiting

| Throttler | الحد | النافذة | يطبّق على |
|---|---|---|---|
| `global` | 100 | 60 ثانية | كل الـ endpoints |
| `auth` | 10 | 60 ثانية | `/auth/*` فقط |

**Tracker:**
- `/auth` routes: IP address
- باقي الـ routes: `tenant:{tenantId}`

**Storage:** Redis — لا تُفقد عند إعادة تشغيل السيرفر.

---

## Headers الأمنية

يُضيفها `helmet` في `main.ts`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`
- `Strict-Transport-Security`

إضافة يدوية:
- `Cache-Control: no-store` على كل الردود

---

## CORS

```typescript
// main.ts
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,  // مطلوب لاستقبال الـ cookie
})
```

---

## Input Validation

`ValidationPipe` مع:
- `whitelist: true` — يحذف الحقول غير المُعرَّفة في الـ DTO
- `forbidNonWhitelisted: true` — يرفض الطلب إذا كان يحتوي حقولاً غير معروفة
- `transform: true` — يحوّل الأنواع تلقائياً

---

## Tenant Isolation

**مبدأ عام:** كل استعلام DB يُضاف له `.eq('tenant_id', tenantId)` صريحاً في الكود.

**استثناء مقصود:** السوبر أدمن يحصل على `tenantId = null` ويمكنه استعلام cross-tenant. هذا النمط موثَّق في الكود:

```typescript
// tenantId is null only for superadmin callers — intentional cross-tenant access
if (tenant.tenantId) {
  query = query.eq('tenant_id', tenant.tenantId);
}
```

---

## Session Security

- كل device_session مرتبطة بـ `user_id` و `tenant_id`
- `revokeSession()` يتحقق من `tenant_id` لمنع إلغاء جلسات مستأجرين آخرين
- السوبر أدمن يمكنه إلغاء أي جلسة

---

## Audit Log

كل عملية مُوسومة بـ `@Audit('action.name')` تُسجَّل في `audit_logs`:
- `tenant_id`
- `actor_id` + `actor_role`
- `action`
- `resource_type` + `resource_id`
- `before_data` + `after_data` (JSON)
- `ip_address`
- `device`

---

## Soft Delete

الحذف لا يزيل البيانات من DB — يضع `deleted_at = now()` فقط.
كل الاستعلامات تُضيف `.is('deleted_at', null)` تلقائياً.

---

## Secrets Management

كل الأسرار (JWT_SECRET، Supabase keys، Redis password) تأتي من:
1. Environment variables (production)
2. `.env` file (development فقط — لا يُضاف لـ git)

`SecretsModule` في `core/secrets` يتحقق من وجود كل المتغيرات المطلوبة عند البدء.
