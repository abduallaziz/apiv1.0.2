# STATUS.md — Sefay V1.02
# Last Updated: Date-picker hardening — single-date variant, portal positioning, z-index fix — June 26, 2026

---

## 📜 سياسة هذا الملف — سجل مهندس (engineering logbook)، لا لقطة حالة فقط

هذا الملف وTASKS.md معًا يشكّلان **الذاكرة الهندسية الكاملة للمشروع**، لا مجرد TODO list أو status snapshot. الهدف: أي مهندس جديد يقرأهما يفهم كل شيء حدث من اليوم الأول حتى الآن — **لماذا** اتُّخذ كل قرار، الخطط السابقة (حتى المرفوضة)، المنطق الهندسي، تطوّر المشروع، تاريخ الـ roadmap، الأفكار المؤجَّلة، النقاشات المعمارية، الدروس المستفادة — وفي نفس الوقت يعكس الحالة الفعلية الدقيقة للكود الآن.

**قواعد إلزامية لكل تعديل مستقبلي على هذا الملف أو TASKS.md:**
1. **لا حذف أبدًا** لقرار هندسي أو قسم تاريخي، إلا إذا كان مكررًا حرفيًا (verbatim duplicate) لشيء آخر بالملف.
2. **تحديث الحالة، لا حذف العنصر**: عنصر قديم أصبح غير صالح/مُستبدَل/مكتمل → يُعلَّم بوضوح (`✅ مكتمل`، `🔄 استُبدل بـ...`، `⏸️ مؤجَّل`، `❌ مرفوض — السبب: ...`) مع إضافة سطر/قسم جديد، **لا** تعديل النص القديم نفسه ليصبح كأنه لم يكن.
3. **الإضافة دائمًا بقسم جديد مرقَّم** (`# N.` بـSTATUS.md، عنوان جديد بـTASKS.md) بتاريخ، لا استبدال فقرة قائمة بمحتوى جديد فوقها.
4. الأرقام/الإحصائيات الإجمالية (عدد الجداول، الموديولات، الـmigrations) **يجوز تحديثها مباشرة** بالقسم المرجعي (مثل §11 PROJECT METRICS) لأنها قيم حالة لحظية، لكن **القرار/السبب الذي أدى إليها يبقى بقسمه التاريخي الأصلي بدون لمس**.
5. خطط مرفوضة أو مؤجَّلة (مثل Phase 13، Phase 12) تبقى موجودة بالكامل مع توضيح "لماذا مؤجَّلة/من قرَّر" — لا تُحذف لأنها "لم تُنفَّذ بعد".
6. عند الشك: **أضِف، لا تحذف**. لو بدا قسم قديمًا جدًا أو زائدًا، اسأل المستخدم قبل حذف أي حرف منه.

---

# 1. CURRENT PHASE

## Active: ---
## Next: Date Picker في OrdersPage
## Completed Through: Phase 9F ✅ + Currency System ✅ + i18n Fixes ✅ + Auth Fixes ✅ + Dark Mode ✅ + Responsive ✅

---

# 2. TECH STACK

## Backend (api)
- NestJS + TypeScript
- Supabase PostgreSQL (direct client — لا Supabase Auth)
- BullMQ + Redis (Queue Infrastructure)
- Stripe + Mock Payment Provider
- Resend (Email Provider — mock mode إذا RESEND_API_KEY فارغ)
- Winston (Structured Logging — JSON in production, colored in dev)
- prom-client (Prometheus Metrics — /api/v1/metrics endpoint)
- Joi (Secrets Validation — startup schema enforcement)
- لا direct DB access من controllers
- لا business logic في controllers
- ScopedRepository يطبق tenant_id على كل query تلقائياً

## Auth
- JWT Access Token (15min)
- Refresh Token Rotation (7d)
- Device Sessions
- RBAC: resource.action.scope

## Payments
- Stripe (production)
- Mock Provider (development)
- Config-based switching via PAYMENT_PROVIDER env

## Infrastructure
- Railway (API hosting)
- Vercel (Frontend hosting)
- Supabase PostgreSQL (Database)
- Redis (Docker local / Railway Redis production)

## Frontend
- Next.js 15 + Tailwind v3
- TanStack Query + Zustand
- react-hook-form + zod
- next-intl (i18n)

## Mobile (Planned)
- React Native + Expo
- SQLite (offline-first)
- MMKV (tokens + settings)

---

# 3. ACTIVE MODULES

| Module | Path | Status |
|---|---|---|
| CoreAuthModule | core/auth/ | ✅ |
| TenantGuard | core/tenant/ | ✅ |
| PermissionGuard | core/permissions/ | ✅ |
| FeatureGuard | core/feature-flags/ | ✅ |
| AuditModule (Core Logging) | core/audit/ | ✅ |
| BillingModule | core/billing/ | ✅ |
| BillingInvoiceService | core/billing/ | ✅ |
| MockPaymentProvider | core/billing/providers/ | ✅ |
| StripePaymentProvider | core/billing/providers/ | ✅ |
| StripeWebhookController | core/billing/ | ✅ |
| DunningService | core/billing/dunning/ | ✅ |
| DunningScheduler | core/billing/dunning/ | ✅ |
| QueueModule | core/queue/ | ✅ |
| QueueRegistry | core/queue/ | ✅ |
| QueueService | core/queue/ | ✅ |
| QueueExistsPipe | core/queue/pipes/ | ✅ |
| DunningProcessor | core/queue/processors/ | ✅ |
| AuditCleanupProcessor | core/queue/processors/ | ✅ |
| NotificationModule | core/notification/ | ✅ |
| ChannelRegistry | core/notification/ | ✅ |
| EmailChannel | core/notification/channels/ | ✅ |
| InAppChannel | core/notification/channels/ | ✅ |
| NotificationProcessor | core/notification/processors/ | ✅ |
| NotificationsRepository | core/notification/repositories/ | ✅ |
| I18nModule | core/i18n/ | ✅ |
| I18nService | core/i18n/ | ✅ |
| LoggerModule | core/logger/ | ✅ |
| AsyncContextService | core/logger/context/ | ✅ |
| LoggerService | core/logger/ | ✅ |
| LoggingInterceptor | core/logger/interceptors/ | ✅ |
| GlobalExceptionFilter | core/logger/filters/ | ✅ |
| MetricsModule | core/metrics/ | ✅ |
| MetricsService | core/metrics/ | ✅ |
| MetricsController | core/metrics/ | ✅ |
| MetricsInterceptor | core/metrics/interceptors/ | ✅ |
| BusinessCollector | core/metrics/collectors/ | ✅ |
| BackupModule | core/backup/ | ✅ |
| BackupService | core/backup/ | ✅ |
| BackupController | core/backup/ | ✅ |
| BackupScheduler | core/backup/ | ✅ |
| SecretsModule | core/secrets/ | ✅ |
| RailwaySecretsProvider | core/secrets/providers/ | ✅ |
| HealthService | modules/superadmin/health/ | ✅ |
| HealthController | modules/superadmin/health/ | ✅ |
| AuthModule | modules/auth/ | ✅ |
| UsersModule | modules/users/ | ✅ |
| BranchesModule | modules/branches/ | ✅ |
| ItemsModule | modules/items/ | ✅ |
| InvoicesModule | modules/invoices/ | ✅ |
| ShiftsModule | modules/shifts/ | ✅ |
| ExpensesModule | modules/expenses/ | ✅ |
| CustomersModule | modules/customers/ | ✅ |
| PlansModule | modules/plans/ | ✅ |
| SubscriptionsModule | modules/subscriptions/ | ✅ |
| PaymentsModule | modules/payments/ | ✅ |
| ReportsModule | modules/reports/ | ✅ |
| SuperAdminModule | modules/superadmin/ | ✅ |
| AnalyticsController | modules/superadmin/controllers/ | ✅ |
| AuditLogsController | modules/superadmin/controllers/ | ✅ |
| QueuesController | modules/superadmin/controllers/ | ✅ |
| NotificationsModule | modules/notifications/ | ✅ |
| NotificationsController | modules/notifications/ | ✅ |
| TenantManagementModule | modules/shared/tenant-management/ | ✅ |
| AnalyticsModule | modules/shared/analytics/ | ✅ |
| TenantsModule | modules/tenants/ | ✅ |
| InventoryModule | modules/inventory/ | ✅ |
| PurchasingModule | modules/purchasing/ | ✅ |
| LocationsModule (جزء من inventory) | modules/inventory/locations/ | ✅ |
| InventoryReportsModule | modules/inventory/reports/ | ✅ |
| OutboxModule (relay scheduler + BullMQ processor) | core/outbox/ | ✅ |
| SecurityModule (Helmet + throttler + IP middleware + branch validator) | core/security/ | ✅ |

---

# 4. DATABASE STATUS

Total Tables: 40+ (آخر تحديث — يونيو 2026، بعد Inventory & Purchasing Core)
Core Domains: 8 (+ Inventory + Purchasing)

## Core Auth Tables ✅
- users
- permissions
- role_permissions
- device_sessions
- refresh_tokens

## Tenant Tables ✅
- tenants (+ currency_code + currency_symbol — June 16, 2026)
- branches
- categories

## Billing Tables ✅
- plans
- subscriptions
- billing_customers
- invoices (billing)
- invoice_items
- payments
- dunning_attempts

## Operational Tables ✅
- orders (invoices)
- order_items
- customers
- expenses
- expense_categories (migration 005)
- shifts
- items
- item_variants
- coupons

## Feature & Permission Tables ✅
- features
- plan_features
- tenant_feature_overrides

## Audit Tables ✅
- audit_logs

## Notification Tables ✅
- notifications

## Migration Tables ✅
- schema_migrations

## Inventory & Purchasing Tables ✅ (migrations 016–032 — راجع §50)
- warehouses
- locations
- suppliers
- batches
- stock_movements
- stock_levels
- cost_layers
- reservations
- purchase_orders
- goods_receipts
- adjustments
- transfers
- counts
- domain_events_outbox

Total Migrations: 32 (001–032، تسلسل متصل بلا فجوات — راجع §50)

---

# 5. ARCHITECTURAL DECISIONS

| القرار | التفاصيل |
|---|---|
| Multi-tenancy | Shared DB + tenant_id isolation على كل query |
| Permission Model | RBAC: resource.action.scope (granular) |
| Guard Pipeline | JwtAuthGuard → TenantGuard → PermissionGuard → FeatureGuard |
| Layering | Controller → Service → Repository — لا business logic في controllers |
| DB Access | ScopedRepository يطبق tenant_id تلقائياً — لا direct DB access من خارج repositories |
| Payment Provider | Stripe (production) + Mock (development) — config-based switching |
| Billing | Dunning Engine + Grace Period (3 days) + Max Attempts (3) |
| Audit | AuditInterceptor + @Audit() decorator — before + after + actor + ip |
| Feature Flags | Per-tenant overrides بدون code changes |
| Auth | JWT 15min + Refresh Token Rotation 7d — Supabase PostgreSQL فقط (لا Supabase Auth) |
| Soft Delete | deleted_at على كل sensitive data |
| Tenant Isolation | ScopedRepository يطبق tenant_id تلقائياً على كل query |
| AI Constraint | AI لا تنفّذ أي action حساس تلقائياً — human approval مطلوب |
| Mobile | Offline-first (SQLite) + Sync Engine (مؤجل) |
| Analytics Strategy | Computed queries حالياً. Redis/materialized views مؤجلة حتى تستدعي الـ scale التحسين (500+ tenants أو ملايين السجلات) |
| Queue Infrastructure | BullMQ + Redis — prefix: sefay — required runtime dependency |
| Queue Architecture | QueueRegistry كـ single source of truth — QueueExistsPipe عبر DI — Split API (list vs detail) |
| Notification Architecture | Dynamic Channel Registry (plugin-based) — self-registering channels — Queue-first dispatch — BullMQ deduplication via jobId |
| Internationalization | I18nService (Global) — Translation Keys فقط — Language Resolution: user → tenant → en |
| i18n Architecture | I18nModule (core/i18n/) — locales/ar + en — resolveJsonModule enabled — notification-templates migrated |
| Health Dashboard | HealthService — indirect Redis ping via BullMQ — parallel health checks — ComponentHealth interface |
| Logging Architecture | LoggerModule (Global) — Winston — AsyncLocalStorage context — JSON in production / colored in dev — tenantId injection automatic — requestId per request |
| Metrics Architecture | MetricsModule (Global) — prom-client — HTTP histogram + business counters + Node.js default metrics — BusinessCollector refreshes active tenants every 5min — GET /api/v1/metrics (Public) |
| Backup & Recovery | BackupModule (core/backup/) — daily integrity check cron — DB + Redis health — RUNBOOK.md — RTO < 1h / RPO < 24h |
| Secrets Management | SecretsModule (Global) — Joi validation at startup — RailwaySecretsProvider (process.env) — extensible via SecretsProvider interface — no secrets in logs |
| Deployment | Railway (API) + Vercel (Web) — auto-deploy on git push to main |
| CI/CD | GitHub Actions — TypeScript build check on every push/PR to main |
| Stripe Init | Lazy initialization — StripePaymentProvider + StripeWebhookController لا يكسران الـ app عند PAYMENT_PROVIDER=mock |
| Frontend API Wiring | Real API calls بدل mock data — apiClient مع JWT auto-refresh — TanStack Query للـ caching |
| Database Migrations | Custom Runner (TypeScript) — Supabase Management API — schema_migrations table — Pre-deploy on Railway |
| Staging Strategy | نفس Supabase DB — Railway service منفصل (sefay-api-staging) — JWT_SECRET مختلف — PAYMENT_PROVIDER=mock — branch staging مستقل — APP_ENV=staging — BullMQ prefix: sefay-staging |
| WAF Strategy | Cloudflare WAF مؤجل حتى شراء domain خاص — الحماية الحالية: Helmet + Rate Limiting + HSTS + CORS |
| Currency System | API مصدر الحقيقة — TenantStore (Zustand + persist) كـ cache — DashboardLayout يحمّل مرة واحدة — كل الكومبوننتات تقرأ من useTenantStore |
| Auth Token Storage | accessToken محفوظ في localStorage (persist) — refreshToken rotation مع mutex لمنع concurrent reuse |

---

# 6. SYSTEM TARGETS

| المعيار | الهدف |
|---|---|
| API Response Time | < 300ms average |
| Tenant Isolation | 100% — لا query بدون tenant_id |
| Availability | 99.9% |
| Audit Coverage | جميع العمليات الحساسة (mutations) |
| Soft Delete | إلزامي على كل business data |
| Auth Token Expiry | Access: 15min / Refresh: 7d |
| Rate Limiting | 100 req/min per IP / 5 req/min على /auth/login |
| RTO | < 1 ساعة |
| RPO | < 24 ساعة (Supabase daily backup) / < 5 دقائق (PITR على Pro) |

---

# 7. KNOWN GAPS
*(مُحدَّث June 26, 2026 — راجع §44 لسبب التحديث. النسخة السابقة كانت تذكر فجوات محلولة فعليًا منذ June 17-20)*

| الثغرة | الأثر | الأولوية |
|---|---|---|
| No Redis caching | Analytics تتباطأ عند scale كبير | منخفض حالياً |
| No object storage | لا رفع ملفات أو صور حالياً | متوسط |
| No SMS Provider | لا SMS notifications | متوسط |
| No Push Notifications | لا push notifications | متوسط |
| Cloudflare WAF | مؤجل — يحتاج domain خاص (قرار مقصود، ليس فجوة سهو) | عالٍ قبل scale |
| SuperAdmin subscriptions list/cancel/manual payment | لا endpoint في backend — جزء من Phase 10M | متوسط |
| Auth Control (superadmin) | endpoints غير موجودة في backend بعد — جزء من Phase 10M | عالٍ |
| SuperAdmin Responsive | لم يُبدأ بعد فعليًا (الثيم Light/Dark مكتمل بـ§41-43، لكن mobile layout/breakpoints لم يُعمل عليها) | متوسط |
| Dynamic platform — تمييز فعلي حسب business_type | البنية كاملة end-to-end لكن `BUSINESS_TYPE_CONFIG` نفس القائمة لكل الأنشطة الـ6 — لا تمييز فعلي بالسايدبار/الميزات بعد | متوسط |
| Mada/Visa/Mastercard/STC Pay/Apple Pay | تُسجَّل كقيمة وسم فقط بلا تمييز معالجة فعلي (Phase 10B) | منخفض — مقصود حاليًا |
| Moyasar / Tap gateways | لم تُربَط فعليًا — لا abstraction مسبق (Phase 10B) | منخفض حاليًا |

## مُزالة من هذا الجدول (محلولة فعليًا، كانت مذكورة خطأً)
- ~~Orders date filter~~ — مكتمل (§20، DateRangePicker)
- ~~POS Mobile Layout~~ — مكتمل (§19)
- ~~Items/Users Mobile~~ — مكتمل (§19)

---

# 8. COMPLETED

## Phase 9F — Production Checklist ✅ (June 16, 2026)
- CORS whitelist — sefayv1-0-2.vercel.app ✅
- Rate limiting — 100 req/min (ThrottlerModule + ThrottlerGuard global) ✅
- Stack traces مخفية في production (GlobalExceptionFilter) ✅
- Helmet security headers ✅
- JWT_SECRET قوي (32+ chars) على Railway ✅
- NODE_ENV=production على Railway ✅
- FRONTEND_URL على Railway ✅
- NEXT_PUBLIC_API_URL على Vercel ✅

## Auth Fixes ✅ (June 16, 2026)
- Refresh token mutex — منع concurrent refresh calls ✅
- accessToken persist في localStorage (Zustand partialize) ✅
- Login i18n — useTranslations('common') + t('auth.*') ✅

## Currency System ✅ (June 16, 2026)
- currency_code + currency_symbol أعمدة مضافة لجدول tenants في Supabase ✅
- Backend updateProfile يقبل ويحفظ currency_code + currency_symbol ✅
- TenantStore (Zustand + persist) — `C:\Fp\web\src\core\tenant\stores\tenant.store.ts` ✅
- DashboardLayout يحمّل currency من API عند أول تحميل فقط (profileLoaded flag) ✅
- Currency picker في Settings page (8 عملات: SAR/USD/EUR/AED/KWD/BHD/QAR/OMR) ✅
- handleSaveName + handleSaveCurrency منفصلين ✅
- formatCurrency(value, currency) dynamic — `C:\Fp\web\src\lib\format.ts` ✅
- كل الكومبوننتات تقرأ من useTenantStore:
  - DashboardOverview ✅
  - OrdersPage + OrdersTable + OrderDetailsModal ✅
  - ReportsPage ✅
  - ItemsTable ✅
  - ShiftsList + ShiftSummaryModal ✅
  - ExpensesList ✅
  - POS: ItemGrid + CartPanel + PaymentModal ✅

## i18n Fixes ✅ (June 16, 2026)
- common.auth namespace مضاف (ar + en) ✅
- pos.loading مضاف ✅
- currency مزال من pos.json namespace ✅
- legacyRoot isolation في request.ts (destructure shifts/expenses/customers) ✅
- items.currency مضاف ✅

## Responsive Fixes ✅ (June 16, 2026)
- DashboardLayout — sidebar RTL mobile fix (rtl:translate-x-full ltr:-translate-x-full) ✅
- DashboardLayout — p-4 lg:p-6 ✅
- Customers — grid-cols-1 sm:grid-cols-3 للـ stats ✅
- Orders — hidden sm:table-cell للأعمدة الثانوية + dark theme ✅
- Orders stats — grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 ✅
- Users — hidden sm:table-cell للأعمدة الثانوية ✅
- Reports — flex-wrap في header ✅
- SuperAdmin dashboard — grid-cols-1 lg:grid-cols-2 ✅

## Frontend API Wiring — مكتمل (June 09, 2026)

| Module | Status | Notes |
|---|---|---|
| Auth | ✅ مكتمل | login/logout/me/refresh |
| Customers | ✅ مكتمل | list/create/edit/delete + loyalty points |
| Shifts | ✅ مكتمل | open/close/current/summary |
| Expenses | ✅ مكتمل | stats + requests (approve/reject) + categories (CRUD) |
| Orders/Invoices | ✅ مكتمل | list + detail (with items) + cancel |
| Items | ✅ مكتمل | real API + mock محذوف + type fixes |
| SuperAdmin | ✅ مكتمل | stats + analytics + audit-logs + health + plans + tenants |

## Phase H — Schema Mismatches Resolution ✅ (June 08, 2026)

جميع الـ 28 مشكلة schema mismatch بين الـ backend والـ frontend تم إصلاحها.

| ID | Severity | Issue | Status | Tested |
|----|----------|-------|--------|--------|
| H-001 | HIGH | `discount` vs `discount_amount` | ✅ Fixed | ✅ curl |
| H-002 | HIGH | `qty` vs `quantity` | ✅ Fixed | ✅ curl |
| H-003 | HIGH | `price` vs `unit_price` | ✅ Fixed | ✅ curl |
| H-004 | HIGH | `total_price` not stored in order_items | ✅ Fixed | ✅ curl |
| H-005 | HIGH | `variant_id/name` dropped on insert | ✅ Fixed | ✅ curl |
| H-006 | HIGH | `cashier_name/customer_name` undefined | ✅ Fixed | ✅ curl |
| H-007 | LOW | `orders_count` vs `total_orders` | ✅ Fixed | frontend type |
| H-008 | MEDIUM | `total_spent` computed, not in table | ✅ Fixed | frontend type |
| H-009 | MEDIUM | `category_name` nested vs flat | ✅ Fixed | ✅ curl |
| H-010 | HIGH | `operation_type` missing from web DTO | ✅ Fixed | frontend type |
| H-011 | CRITICAL | `amount_due` vs `total_amount` dunning | ✅ Fixed | previous session |
| H-012 | CRITICAL | `billing_invoices` vs `invoices` Stripe | ✅ Fixed | previous session |
| H-013 | HIGH | `expires_at` never written | ✅ Fixed | ✅ curl |
| H-014 | HIGH | `max_users/branches` never written | ✅ Fixed | ✅ curl |
| H-015 | CRITICAL | `branch_id/shift_id` body vs headers | ✅ Fixed | frontend type |
| H-016 | HIGH | `billing_cycle` vs `interval` | ✅ Fixed | frontend type |
| H-017 | HIGH | `tenant_name` not in subscriptions | ✅ Fixed | frontend type |
| H-018 | HIGH | `plan_name` not in subscriptions | ✅ Fixed | frontend type |
| H-019 | HIGH | `amount_paid` not in subscriptions | ✅ Fixed | frontend type |
| H-020 | HIGH | `owner_name/email` not in tenants | ✅ Fixed | ✅ curl |
| H-021 | MEDIUM | `subscription_plan` not in tenants | ✅ Fixed | ✅ curl |
| H-022 | MEDIUM | `users/branches_count` require COUNT | ✅ Fixed | ✅ curl |
| H-023 | LOW | Two conflicting Tenant types | ✅ Fixed | re-export |
| H-024 | HIGH | `user_name/email/tenant_name` in sessions | ✅ Fixed | ✅ curl |
| H-025 | CRITICAL | `attempted_at` never written | ✅ Fixed | cron job |
| H-026 | HIGH | `grace_period_ends_at` never written | ✅ Fixed | cron job |
| H-027 | MEDIUM | `services` vs `service` enum mismatch | ✅ Fixed | ✅ curl |
| H-028 | HIGH | `FeatureWithOverride` no backend endpoint | ✅ Fixed | ✅ curl |

## Phase 3 — Owner/Tenant Self-Service APIs ✅
- GET /api/v1/tenant/profile ✅
- PATCH /api/v1/tenant/profile (+ currency_code + currency_symbol) ✅
- GET /api/v1/tenant/subscription ✅
- GET /api/v1/tenant/usage ✅

## Phase 4A — Billing Engine Core ✅
## Phase 4B — Dunning Engine ✅
## Phase 4C — StripeProvider + Webhooks ✅
## Phase 5 — Advanced Platform Analytics ✅
## Phase 6 — Audit Center Expansion ✅
## Phase 7A — BullMQ Infrastructure ✅
## Phase 7B — Job Queue Dashboard & Monitoring ✅
## Phase 7C — Notification Center ✅
## Phase 7C.1 — i18n Architecture ✅
## Phase 7D — System Health Dashboard ✅
## Phase 8A — Structured Logging (Winston) ✅
## Phase 8B — Metrics (Prometheus/prom-client) ✅
## Phase 8C — Backup & Disaster Recovery ✅
## Phase 8D — Secrets Management & Validation ✅
## Phase 9A — Repository & Deployment Setup ✅
## Phase 9B — CI/CD Pipeline ✅
## Phase 9C — Database Migrations Strategy ✅
## Phase 9D — Staging Environment ✅
## Phase 9E — WAF & Network Security ✅
## Phase 9F — Production Checklist & Go-Live ✅

---

# 9. UPCOMING

## Responsive Design — المتبقي
| المهمة | الأولوية |
|---|---|
| POS Mobile Layout (cart مخفي على موبايل) | 🔴 عالية |
| Items Mobile (جدول → cards) | 🔴 عالية |
| Users Mobile | 🟡 متوسطة |
| SuperAdmin pages responsive | 🟡 متوسطة |
| Orders date picker (date picker library) | 🟢 منخفضة |

## بعد الـ Responsive
- ميزات V1 الجديدة (Phase 10A → 10M) — موثقة في FEATURES.md
- Mobile POS (Phase E) — مؤجل حتى اكتمال الـ web

---

# 10. DEFERRED ⏸️

## Phase D — Expansion
- AI features
- Marketplace
- Workflow automation

## Phase E — Mobile POS
- E1 — Setup (Expo, SQLite, MMKV, Zustand)
- E2 — Auth + Sync Engine
- E3 — POS Engine (Offline)
- E4 — Expense Flow
- E5 — Shift Engine
- E6 — Printing Engine (Sunmi + Bluetooth)

## Expenses
- إضافة type/recurrence مع scheduler
- إلغاء المصروف (cancel)

---

# 11. PROJECT METRICS

| المقياس | القيمة |
|---|---|
| Backend Modules | 42+ (Inventory + Purchasing مضافة) |
| Database Tables | 49 (عدّ مباشر لـ `CREATE TABLE` عبر كل الـmigrations 001–038، تحقق بتاريخ 2026-07-03) |
| API Endpoints | 199 (عدّ مباشر لـ `@Get`/`@Post`/`@Patch`/`@Put`/`@Delete` عبر كل الـcontrollers، تحقق بتاريخ 2026-07-03 — رقم لحظي، بيزيد مع كل endpoint جديد، مش هدف ثابت) |
| Schema Mismatches Fixed | 28/28 ✅ |
| Core Domains | 8 (+ Inventory + Purchasing) |
| Database Migrations | 38 (001–038) |
| Inventory/Purchasing Core | ✅ مكتمل ومنشور بالكامل — راجع §50 |
| Payment Providers | 2 (Stripe + Mock) |
| Queue Infrastructure | BullMQ + Redis |
| Queue Processors | 6 (Dunning + AuditCleanup + Notification + AI + PlatformAnalytics + Outbox/domain-events) |
| Notification Channels | 2 (Email + InApp) — Dynamic Registry |
| i18n Locales | 2 (ar + en) |
| Logging | Winston — Structured JSON — AsyncLocalStorage context |
| Metrics | prom-client — Prometheus format — HTTP + Business + Node.js |
| Backup & Recovery | BackupModule + RUNBOOK.md — RTO < 1h / RPO < 24h |
| Secrets Management | SecretsModule + Joi validation + RailwaySecretsProvider + SECRETS.md |
| Deployment | Railway (API) + Vercel (Web) — auto-deploy on git push |
| CI/CD | GitHub Actions — TypeScript build check — passing ✅ |
| Database Migrations Runner | Custom Runner — Supabase Management API — schema_migrations table ✅ |
| Staging Environment | محذوفة جزئياً — فرع `staging` وworkflow الخاص بيه على GitHub اتحذفوا (commit `aec829c`)، لكن خدمة `sefay-api-staging-production` على Railway لسه موجودة، بانتظار حذف يدوي من لوحة Railway (راجع TASKS.md) |
| Security Headers | Helmet — 10 headers مفعّلة — مختبرة على production ✅ |
| Deployment Targets | 3 (Railway + Vercel + App Stores) |
| Supported Roles | 6 (superadmin, owner, manager, inventory_clerk, cashier, worker) |
| Permissions | 50 |
| Frontend Modules Wired | 7/7 (Auth, Customers, Shifts, Expenses, Orders, Items, SuperAdmin) ✅ |
| Currency Support | 8 عملات (SAR/USD/EUR/AED/KWD/BHD/QAR/OMR) |

---

# 12. REFERENCES 📎

- Architecture + Domain Boundaries → C:\Fp\docs\architecture.md
- Engineering Rules + Constraints → C:\Fp\docs\rules.md

---

# 13. PROJECT PATHS 📁

| المشروع | المسار | الاستضافة |
|---|---|---|
| api | C:\Fp\api | Railway |
| web | C:\Fp\web | Vercel |
| pos_m | C:\Fp\pos_m | App Store / Play Store |
| .env | C:\Fp\api\.env | root فقط |

---

# 14. PRODUCT PLANNING SESSION — June 12, 2026

## قرار استراتيجي — إعادة بناء الداشبورد من الصفر
- القرار: إعادة تصميم الـ dashboard كاملاً من الصفر (لا تحسين على الموجود)
- السبب: التصميم الحالي لا يعكس جودة منتج SaaS مدفوع
- المرجع الكامل: DESIGN.md (جديد — أُنشئ June 12, 2026)

## ملفات جديدة أُنشئت في هذه الجلسة

| الملف | الغرض | تاريخ الإنشاء |
|---|---|---|
| FEATURES.md | قائمة ميزات المنتج الكاملة (V1 + V2/V3) | June 12, 2026 |
| DESIGN.md | قرارات التصميم الكاملة (ألوان + layout + تفاعل + sidebar) | June 12, 2026 |

## الأنشطة المستهدفة في V1
1. بقالات وسوبرماركت
2. محلات ملابس وأحذية
3. صيدليات ومستلزمات طبية
4. مطاعم (سحابية / وجبات سريعة / فاخرة)
5. كافيهات وعربات أطعمة (فود تراك)
6. مغاسيل سيارات

## قرارات التصميم المحددة (DESIGN.md)

| القرار | القيمة |
|---|---|
| اللون الرئيسي | #0C447C |
| الكارد | حافة علوية ملونة + corners مدورة أسفل فقط |
| حجم الأرقام | 24px — font-weight: 500 |
| التفاعل | translateY(-2px) + background info عند hover — transition 0.18s |
| الـ layout | topbar أزرق (#0C447C) + sidebar عريض بنصوص |
| Default mode | Light — Dark mode خيار للمستخدم |
| لغة الواجهة | عربي / إنجليزي (المستخدم يختار) |
| الأرقام | إنجليزية دائماً — `value.toLocaleString('en-US')` |

---

# 15. FRONTEND POLISH SESSION — June 14-15, 2026

## ما تم إنجازه

### UI/UX Fixes
- ✅ Dark theme fixes: ItemFormModal, CustomerFormModal, CustomerFilters, OpenShiftModal, CloseShiftModal, ShiftSummaryModal, OrdersPage, OrderFilters, CartPanel, PaymentModal, ReceiptModal, ItemsTable, VariantsModal, DashboardOverview, ReportsPage, SettingsPage, CustomersPage, ShiftsPage
- ✅ الأرقام إنجليزية دائماً
- ✅ i18n namespaces — expenses/customers/shifts/reports بعد legacyRoot في request.ts

### Shifts
- ✅ فتح/إغلاق ديناميكي بدون F5
- ✅ cashier_name من join مع users

### POS
- ✅ ربط بـ real API — createOrder
- ✅ كاش + بطاقة + مختلط
- ✅ Variants من API

### Expenses — إعادة بناء كاملة
- ✅ expense_categories جديد (migration 005)
- ✅ موافقة/رفض + إحصائيات

## ملاحظات تقنية
- expense_categories: GRANT ALL + DISABLE RLS
- shifts/current: backend يرجع null صريح
- cash_tendered مطلوب في backend للدفع النقدي

---

# 16. RESPONSIVE + CURRENCY SESSION — June 16, 2026

## ما تم إنجازه

### Phase 9F ✅
- CORS + Rate Limiting + Helmet + JWT_SECRET + NODE_ENV + env vars ✅

### Auth ✅
- Refresh token mutex ✅
- accessToken persist في localStorage ✅
- Login i18n fix ✅

### Currency System ✅
- currency_code + currency_symbol في Supabase tenants ✅
- Backend updateProfile يقبل currency fields ✅
- TenantStore (Zustand + persist) ✅
- DashboardLayout — hydrate مرة واحدة فقط ✅
- Currency picker في Settings (8 عملات) ✅
- formatCurrency(value, currency) dynamic ✅
- كل الكومبوننتات → useTenantStore ✅

### Responsive ✅
- Sidebar RTL mobile fix ✅
- Customers/Orders/Users/Reports/SuperAdmin dashboard grid fixes ✅

### i18n ✅
- common.auth + pos.loading + legacyRoot isolation ✅

## ملاحظات تقنية
- TenantStore: `C:\Fp\web\src\core\tenant\stores\tenant.store.ts`
- profileLoaded flag في DashboardLayout يمنع overwrite بعد أول load
- handleSaveCurrency في Settings يستدعي setCurrency مباشرة بعد API success
- POS currency: useTenantStore بدل t('currency') من i18n
---

# 17. DASHBOARD REBUILD SESSION — June 16, 2026

## ما تم إنجازه

### Dashboard Rebuild ✅
- إعادة بناء الداشبورد كاملاً من الصفر حسب DESIGN.md
- topbar أزرق (#0C447C) ثابت أعلى الصفحة
- sidebar light (أبيض) مع sections collapsible
- كاردات بـ border-top أزرق + border-radius 0 0 12px 12px
- StatCard + PaymentBar components جديدة
- DashboardOverview responsive (grid-cols-2 → xl:grid-cols-4)

### Sidebar ✅
- nav.config.ts — كل sections من DESIGN.md (8 sections)
- NAV_BOTTOM — الإشعارات + الاشتراك
- Collapsible sections (useState open/close)
- coming-soon page لكل الروابط غير الجاهزة
- RTL/LTR support كامل

### i18n Fix ✅
- request.ts مبسط — يقرأ ar.json / en.json مباشرة
- دمج namespace files من ar/ و en/ مع root files
- shell من ar.json له الأولوية على ar/shell.json
- كل الترجمات شغالة (ar + en)

### Header ✅
- DashboardHeader — topbar أزرق
- language switcher (AR/EN)
- notifications bell
- user avatar

## ملفات تم تعديلها
- C:\Fp\web\src\features\dashboard\components\DashboardSidebar.tsx
- C:\Fp\web\src\features\dashboard\components\DashboardHeader.tsx
- C:\Fp\web\src\features\dashboard\components\DashboardLayout.tsx
- C:\Fp\web\src\features\dashboard\pages\DashboardOverview.tsx
- C:\Fp\web\src\features\dashboard\config\nav.config.ts
- C:\Fp\web\src\i18n\request.ts
- C:\Fp\web\messages\ar.json
- C:\Fp\web\messages\en.json
- C:\Fp\web\src\app\[locale]\dashboard\coming-soon\page.tsx

### Dark/Light Mode Toggle ⏸️ مؤجل
- القرار: Light mode افتراضي (مطبق)
- Dark mode كخيار للمستخدم — مؤجل لمرحلة لاحقة
- السبب: الأولوية للـ responsive والمحتوى أولاً
---

# 18. DARK/LIGHT MODE SESSION — June 17, 2026

## ما تم إنجازه

### Theme System ✅
- useThemeStore (Zustand + persist) — `C:\Fp\web\src\core\theme\stores\theme.store.ts`
- ThemeProvider — يطبق dark class على html — `C:\Fp\web\src\core\theme\components\ThemeProvider.tsx`
- DashboardLayout يضم ThemeProvider ✅
- Moon/Sun toggle في DashboardHeader ✅
- sefay-theme key في localStorage ✅

### Header RTL Fix ✅
- اسم المستخدم في start (يمين في RTL) ✅
- أزرار الأدوات في end (يسار في RTL) ✅
- flex-1 spacer بدل ms-auto ✅

### Dashboard Dark Mode ✅
- DashboardOverview — dark classes كاملة ✅
- DashboardSidebar — dark classes كاملة ✅
- DashboardLayout — dark bg ✅
- StatCard border-s border-e border-b dark:border-gray-800 (بدون top) ✅

### Pages Dark Mode ✅
- CustomersPage ✅
- OrdersPage ✅
- ExpensesPage ✅
- ItemsPage ✅
- ShiftsPage ✅
- SettingsPage ✅

### Components Dark Mode ✅
- CustomerFilters ✅
- CustomerFormModal ✅
- OrdersTable ✅
- OrderFilters ✅
- OrderDetailsModal ✅
- ShiftsList ✅
- ItemsTable ✅
- ItemFilters ✅
- ItemFormModal ✅
- ExpensesList ✅
- CategoriesList ✅
- AddExpenseModal ✅
- AddCategoryModal ✅
- OpenShiftModal ✅
- CloseShiftModal ✅

## ملفات جديدة
- C:\Fp\web\src\core\theme\stores\theme.store.ts
- C:\Fp\web\src\core\theme\components\ThemeProvider.tsx

## ملاحظات تقنية
- darkMode: 'class' في tailwind.config.ts (كان موجوداً مسبقاً) ✅
- الهيدر يبقى أزرق (#0C447C) في dark و light mode — لا dark: override ✅
- الكاردات: dark:border-s dark:border-e dark:border-b dark:border-gray-800 بدل dark:border لتجنب تغطية border-top الأزرق ✅
- الملفات التي عندها dark classes مسبقاً ولم تُعدَّل: CustomersTable, CustomerDetailsModal, DeleteCustomerModal, CancelOrderModal, CurrentShiftBanner ✅

### Pages Dark Mode (الدورة الثانية) ✅
- ReportsPage ✅
- UsersPage ✅
- POSPage ✅

### Components Dark Mode (الدورة الثانية) ✅
- ShiftSummaryModal ✅
- VariantsModal ✅

### Components Dark Mode (الدورة الثالثة) ✅
- CreateUserDialog ✅

## المتبقي من Dark Mode
- SuperAdmin pages (تستخدم navy theme منفصل — لا تحتاج dark mode) — مقفول

## 🎉 Dark Mode كامل على كل صفحات وكومبوننتات الـ tenant dashboard

## ملاحظات تقنية إضافية
- ReportsPage/UsersPage/ShiftSummaryModal/VariantsModal كانت تستخدم hardcoded dark navy (#141720, #0d1117, #1e2130) — تحوّلت إلى dark: classes
- POSPage: cart panel فقط يحتاج dark classes — bg-white dark:bg-gray-800
- ROLE_COLORS في UsersPage: أُضيف dark: variant لكل لون
- dark mode كامل على كل صفحات وكومبوننتات الـ tenant dashboard ✅

---

# 19. RESPONSIVE + DARK MODE COMPLETION SESSION — June 17, 2026

## ما تم إنجازه

### Responsive ✅
- DashboardLayout — sidebar RTL/LTR fix على الجوال ✅
- DashboardSidebar — onClose prop + يغلق عند الضغط على أي رابط ✅
- DashboardHeader — RTL/LTR conditional rendering (menu يمين في AR، أدوات يسار) ✅
- POSPage — mobile tabs (items / cart) بدل side by side ✅
- ItemGrid — dark mode + responsive ✅
- CartPanel — dark mode + responsive ✅
- OrdersTable — min-w + hidden columns على الجوال ✅
- ItemsTable — hidden columns على الجوال ✅
- CustomersPage — stats cards responsive ✅
- ExpensesList — overflow-x-auto + hidden columns ✅
- ShiftsList — hidden columns على الجوال ✅
- UsersPage — overflow-x-auto + min-w ✅

### Dark Mode (اكتمل) ✅
- ReportsPage ✅
- UsersPage ✅
- POSPage ✅
- ShiftSummaryModal ✅
- VariantsModal ✅
- CreateUserDialog ✅

### Saudi Riyal Font ⚠️
- تم install `@emran-alhaddad/saudi-riyal-font` ✅
- تم import في layout.tsx ✅
- tenant.store.ts يحول ⃁ → U+E900 ✅
- المشكلة: الرمز لا يظهر صح على الجوال بعد — مؤجل ⏳

## مشاكل معروفة ومؤجلة
- رمز الريال السعودي ⃁ لا يظهر صح على الجوال — يحتاج تحقيق أعمق
- Date picker في OrdersPage غير مضاف بعد ⏳

## التالي بالترتيب
1. Date picker في OrdersPage
2. Expense cancellation feature
3. رمز الريال السعودي ⃁ — مؤجل لحين دعم Unicode 17 على الأجهزة
4. Recurring expenses scheduler
5. Dynamic platform based on business_type
6. Feature/settings audit
7. Sidebar links fix
8. Phase E — Mobile POS
# 20. DATE PICKER SESSION — June 17, 2026

## ما تم إنجازه

### Orders Date Filter ✅
- إضافة date_from / date_to params في invoices controller ✅
- إضافة date_from / date_to في invoices service ✅
- إضافة .gte / .lte filter في invoices repository ✅

### DateRangePicker Component ✅
- C:\Fp\web\src\shared\ui\date-range-picker\DateRangePicker.tsx
- Zero dependencies — بدون input type="date" — كل شيء custom React
- Presets: اليوم / أمس / آخر 7 أيام / آخر 30 يوم / هذا الشهر / الشهر الماضي / آخر 3 أشهر / هذه السنة
- Calendar كامل: days / months / years views
- شهر وسنة منفصلين قابلين للضغط
- From / To fields تفاعلية
- Hover preview للـ range
- i18n كامل (ar/en) عبر useTranslations + Intl.DateTimeFormat
- قابل للاستخدام في أي صفحة
- مضاف في OrderFilters.tsx

### i18n ✅
- datePicker namespace في ar.json و en.json
- orders namespace مكتمل في ar.json و en.json

## ملاحظات تقنية
- calView كـ string cast يحل TypeScript overlap error في JSX
- Intl.DateTimeFormat يأخذ locale تلقائياً — لا hardcoded أشهر أو أيام
- align prop (left/right) للتحكم في موضع الـ dropdown
- index.ts يعرض DateRangePicker و DateRange type
# 21. EXPENSE CANCELLATION SESSION — June 17, 2026

## ما تم إنجازه

### DB ✅
- إضافة `'cancelled'` لـ CHECK constraint في جدول expenses ✅

### Backend ✅
- `PATCH /expenses/:id/cancel` — إلغاء pending فقط ✅
- `canReject()` يقبل `approved` → تراجع عن الموافقة ✅
- `ApprovalStatus` type يشمل `'cancelled'` ✅
- `MetricsService.recordExpense` يقبل `'cancelled'` ✅
- `findAll` يعمل join على `expense_categories` ✅
- prefix "Approval Reversed" في notes عند التراجع ✅

### Frontend ✅
- زر إلغاء 🚫 على `pending` ✅
- زر تراجع ↩ على `approved` ✅
- Cancel confirmation modal ✅
- Reverse approval modal (برتقالي) ✅
- `useCancelExpense` hook ✅
- `expensesApi.cancel()` ✅
- Optimistic delete للـ categories ✅
- `ExpenseStatus` type يشمل `'cancelled'` ✅

### i18n ✅
- `status.cancelled` في ar/en ✅
- `actions.cancel` + `actions.back` + `actions.reverse` في ar/en ✅
- `cancel.title` + `cancel.confirm` + `cancel.submit` في ar/en ✅
- deep merge في `request.ts` للـ expenses namespace ✅

## ملاحظات تقنية
- `ar/expenses.json` و `en/expenses.json` هم المصدر الفعلي — لا `ar.json`/`en.json`
- request.ts يعمل deep merge على actions/status/cancel/reject
- Vercel redeploy مطلوب بعد i18n changes
# 22. SECURITY & BUG REMEDIATION SESSION — June 20, 2026

## ما تم إنجازه — إغلاق 80 مشكلة مُدقَّقة

### المرحلة 1 — إغلاق الثغرات الأمنية ✅
- 1.1: PermissionGuard مضاف لـ branches/customers/expense-categories/expense-templates controllers
- 1.2: BranchValidatorService مفعّل في TenantGuard — فحص ملكية الفرع
- 1.3: JWT نُقل من localStorage إلى httpOnly cookie (sefay_refresh)
- 1.4: seed:permissions مصحح (key→name) + seed:full مربوط + كلمات مرور من env
- 1.5: auth-control → coming-soon page

### المرحلة 2 — تصحيح السجلات المالية ✅
- 2.1: عقد الخصم موحَّد (discount: {type,value} بدل discount_amount)
- 2.2: tax_rate من DB (tenants.tax_rate) — لا يُقبَل من العميل
- 2.3: billing_invoices/invoices — محلول مسبقاً (H-012) ✅
- 2.4: SubscriptionStatus موحَّد في billing.types.ts فقط
- 2.5: حقول Orders مصحَّحة (quantity/unit_price/discount_amount)

### المرحلة 3 — إعادة تفعيل الأنظمة المعلّقة ✅
- 3.1: FeatureFlagsModule مستورد في app.module.ts
- 3.2: notify() مفعّل في invoices/expenses/shifts/dunning
- 3.3: DunningScheduler يضع Jobs في BullMQ بدل استدعاء مباشر

### المرحلة 4 — تصحيح عقود الواجهة الأمامية ✅
- 4.1: AnalyticsPeriod موحَّد ('30d'|'90d'|'6m'|'12m'|'ytd')
- 4.2: current_period_end + used/limit في SettingsPage
- 4.3: الأرقام والتواريخ إنجليزية دائماً — lib/format.ts يبقى
- 4.4: تبويبات المصاريف مصحَّحة
- 4.5: nav.config.ts — روابط حقيقية فقط + customers + notifCount=0
- 4.6: mrr محسوب من plan في TenantManagementRepository

### المرحلة 5 — نظافة الكود ✅
- 5.1: GET /test-permission محذوف
- 5.2: BillingModule import غير مستخدم محذوف من branches.module.ts
- 5.3: filename escape آمن في migrate.ts
- 5.4: خط ريال سعودي محلي (public/fonts/) بدل CDN
- 5.5: ملف dir الأثري محذوف

### بنود إضافية ✅
- #52: AuditCleanupScheduler — cron أسبوعي يضع Job في الطابور
- #55: logging.interceptor.ts — tenant_id snake_case
- #58: env.validation.ts — JWT_EXPIRES_IN بدل JWT_EXPIRY
- #65: proxy.ts — فحص sefay_refresh cookie على /dashboard و/superadmin
- #66: use-auth.ts — setAuth معاملان + useLocale()
- #69: adjustPoints محذوف من customers.api.ts
- #76: activity-feed + ai-insights شارة Demo، command-palette أوامر آمنة فقط
- #78: getPlanFeatures/resetOverride محذوفة من feature-flags.api.ts
- #79: auth-control coming-soon مطبّق

## DB Changes
- `ALTER TABLE tenants ADD COLUMN tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.15`

## الملخص النهائي
**80/80 مشكلة مغلقة — June 20, 2026 ✅**

| التصنيف | العدد |
|---|---|
| 🔴 حرج | 8 ✅ |
| 🟠 عالٍ | 16 ✅ |
| 🟡 متوسط | 6 ✅ |
| 🟢 منخفض | 5 ✅ |
# 22B. DESIGN & PROTOTYPING SESSION — June 22, 2026

*(Renumbered from a duplicate "# 22." heading — this section and the "SECURITY & BUG REMEDIATION SESSION" section above it were both accidentally numbered 22. Content unchanged; only the section number was disambiguated, per this file's own rule against altering historical text.)*

## ما تم إنجازه

### إصلاحات منشورة على Vercel/Railway
- ✅ إصلاح انهيار صفحة المصروفات (حرف عربي شاذ في الكود)
- ✅ إصلاح صفر المبيعات/المصاريف في الداشبورد الرئيسي
- ✅ إصلاح صلاحيات الـ sidebar لروابط الطلبات والمصروفات

### ملاحظة Railway
- تأكد من وجود `Seeding permissions... Done ✓` في Logs قبل إقلاع Nest
- سجّل خروج/دخول بعد كل deploy وجرّب الروابط

### ثلاثة ملفات HTML Prototype (تصميم مرجعي — ليست كوداً فعلياً)

#### sefay-dashboard.html ✅
- Hero band: شريط navy gradient + area chart + بطاقتان زجاجيتان
- 4 stat cards مع sparklines (Chart.js)
- Bar chart (هذا الأسبوع vs الأسبوع الماضي) + Doughnut (طرق الدفع)
- آخر النشاطات + أكثر المنتجات مبيعاً + إجراءات سريعة
- Period tabs تحدّث Hero + Charts + الأرقام معاً
- DateRangePicker: presets + custom from/to
- Sidebar: 6 أقسام + subscription card
- Topbar: navy gradient مطابق للهوية
- SVG stroke icons، stroke-width 2–2.2
- Animations: fadeUp stagger، sparklines، hero area chart
- Polish: glow pulse، hover lift، glass cards

#### sefay-landing.html ✅
- Navbar navy gradient مطابق للداشبورد
- Hero: عنوان + preview داشبورد مصغّر + float badges متحركة
- Trust stats + 6 feature cards + 6 business types
- 3 pricing tiers مع featured animated border
- 3 testimonials + CTA + footer كامل
- Auth modals: تسجيل دخول (Google/Apple) + إنشاء حساب + استعادة كلمة المرور
- Scroll reveal (IntersectionObserver)
- ثنائي اللغة كامل (عربي RTL / إنجليزي LTR)
- Polish: nav underline، hero stagger، gradient border، decorative quotes

#### sefay-onboarding.html ✅
- Wizard 4 خطوات مع progress bar متحرك
- الخطوة 1: معلومات المنشأة
- الخطوة 2: اختيار النشاط — 8 أقسام accordion → 37 نشاطاً:
  - المطاعم والأغذية (6): مطاعم، كافيهات، وجبات سريعة، مخابز، عصائر، عربات طعام
  - البيع بالتجزئة (5): بقالات، سوبرماركت، عطور وعود، قرطاسية، هدايا وألعاب
  - الأزياء والموضة (5): رجالية، نسائية، أحذية وحقائب، إكسسوارات، خياطة
  - الصحة والعناية (5): صيدليات، مستلزمات طبية، عيادات، نظارات، مكملات
  - الجمال والصالونات (4): حلاقة، صالونات نسائية، سبا، مستحضرات
  - الخدمات (5): مغاسل سيارات، مغاسل ملابس، صيانة جوالات، ورش سيارات، خدمات منزلية
  - الإلكترونيات (3): جوالات، أجهزة إلكترونية، ألعاب
  - المنزل والأثاث (4): أثاث، أدوات منزلية، ورود، مستلزمات حيوانات
- الخطوة 3: إعدادات (فرع، مدينة، عملة، VAT toggle)
- الخطوة 4: ملخص + دخول للوحة التحكم
- Polish: dot pulse، checkmark bounce، step slide، category glow

## Design Tokens المعتمدة (مرجع للكود الفعلي)
- Primary: #0C447C | Brand2: #1565C0 | Brand3: #2671C4
- Navbar gradient: #082F5C → #0C447C → #1761B8
- Font AR: IBM Plex Sans Arabic | Font EN: Inter
- Border radius: card=20px، small=14px، extra-small=11px
- Icons: SVG stroke، stroke-width 2–2.2، fill none

## التدفق المحدد (User Journey)
Landing Page → نافذة التسجيل (حساب فقط) →
# 23. DESIGN SYSTEM IMPLEMENTATION — June 22, 2026

## المهمة
تطبيق نظام التصميم الجديد (من الـ Prototypes) فعلياً في C:\Fp\web

## الملفات المطلوب تعديلها (بالترتيب)

### المرحلة الأولى — الأساس
- [ ] `C:\Fp\web\src\app\globals.css` — CSS variables جديدة
- [ ] `C:\Fp\web\tailwind.config.ts` — design tokens
- [ ] `C:\Fp\web\src\shared\layout\header.tsx` — topbar navy gradient
- [ ] `C:\Fp\web\src\features\dashboard\components\DashboardSidebar.tsx` — glass sidebar

### المرحلة الثانية — الداشبورد
- [ ] `C:\Fp\web\src\shared\ui\stat-card.tsx` — glass + stripe + sparkline
- [ ] `C:\Fp\web\src\features\dashboard\pages\DashboardOverview.tsx` — Hero Band
- [ ] Chart cards بـ Recharts

### المرحلة الثالثة — Landing + Onboarding
- [ ] Landing Page route
- [ ] Onboarding Wizard route (4 خطوات + 37 نشاط)

### المرحلة الرابعة — Polish
- [ ] Animations (Framer Motion)
- [ ] Scroll reveal
- [ ] Responsive fixes

## المرجع
DESIGN.md — قسم 22 (ترتيب التنفيذ)
# 24. SAR SYMBOL FIX — June 22, 2026

## المشكلة
رمز الريال ﷼ كان مؤجلاً بسبب محدودية دعم الخطوط للرمز.

## الحل
- تم تحميل ملف الخط مباشرة من GitHub
- الخط مخصص لرمز الريال السعودي ﷼ (U+FDFC)
- الملف محلي — لا اعتماد على CDN

## الملفات
- `C:\Fp\web\public\fonts\saudi_riyal_regular.woff2`
- `C:\Fp\web\public\fonts\SaudiRiyal.css`

## الحالة
✅ مكتمل — يعمل على desktop وجوال
# 25. RECURRING EXPENSES SCHEDULER — June 22, 2026

## ما تم إنجازه

### DB ✅
- إضافة `recurrence_type` CHECK ('none','daily','weekly','monthly') DEFAULT 'none' على `expense_templates` ✅
- إضافة `recurrence_day` integer NULL على `expense_templates` ✅
- إضافة `next_run_at` timestamptz NULL على `expense_templates` ✅
- إضافة `is_pre_approved` boolean DEFAULT false على `expense_templates` ✅

### Backend ✅
- `ExpenseTemplatesService` + `ExpenseTemplatesController` — controller مستقل ✅
- `GET /expense-templates` ✅
- `POST /expense-templates` ✅
- `PATCH /expense-templates/:id` ✅
- `DELETE /expense-templates/:id` (soft delete) ✅
- `processRecurringExpenses()` في `expenses.service.ts` ✅
- Cron يومي 00:00 في `expenses.scheduler.ts` ✅
- `is_pre_approved` — expenses تُنشأ بـ `approved` تلقائياً إذا فعّل ✅

### Frontend ✅
- تبويب "المتكررة" في صفحة المصروفات ✅
- `TemplatesList.tsx` — جدول كامل مع: تكرار / يوم / تشغيل تالي / نشط-معطل / موافقة مسبقة / تعديل / حذف ✅
- `AddTemplateModal` — إضافة قالب جديد مباشرة من الصفحة ✅
- حذف حقل التكرار من `AddExpenseModal` ✅
- `useCreateExpenseTemplate` / `useDeleteExpenseTemplate` / `useUpdateExpenseTemplate` hooks ✅
- i18n: `tabs.recurring` في ar/en ✅

## ملاحظات تقنية
- `expense_templates` هي القوالب — تنشئ expenses تلقائياً كل دورة
- `expenses` العادية نوعها `one_time` دائماً من الـ modal
- `recurrence_type = 'none'` → زر الموافقة المسبقة disabled
- Scheduler يحسب `next_run_at` بعد كل run ويحدّثه
# 26. DESIGN SYSTEM V2 — June 23, 2026

## المهمة
تطبيق نظام التصميم الجديد (من الـ Prototypes) فعلياً في C:\Fp\web

## ما تم إنجازه

### المرحلة الأولى — الأساس ✅
- `C:\Fp\web\src\app\globals.css` — CSS variables كاملة (light + dark + utilities + keyframes) ✅
- `C:\Fp\web\tailwind.config.ts` — design tokens كاملة (colors + radius + shadows + animations) ✅
- `C:\Fp\web\src\shared\layout\header.tsx` — topbar navy gradient + theme toggle + user avatar ✅
- `C:\Fp\web\src\features\dashboard\components\DashboardSidebar.tsx` — glass sidebar + role filter + subscription card ✅
- `C:\Fp\web\messages\ar.json` — كامل مع header + sidebar + landing + onboarding namespaces ✅
- `C:\Fp\web\messages\en.json` — كامل مع header + sidebar + landing + onboarding namespaces ✅

### المرحلة الثانية — الداشبورد ✅
- `C:\Fp\web\src\shared\ui\stat-card.tsx` — glass + stripe + sparkline SVG inline + variants ✅
- `C:\Fp\web\src\features\dashboard\pages\DashboardOverview.tsx` — Hero Band + stat cards + payment bars + quick actions ✅

### المرحلة الثالثة — Landing + Onboarding ✅
- `C:\Fp\web\src\features\landing\pages\LandingPage.tsx` — landing page كاملة (navbar + hero + stats + features + sectors + pricing + CTA + footer + auth modal) ✅
- `C:\Fp\web\src\app\[locale]\page.tsx` — يعرض LandingPage (public — لا redirect) ✅
- `C:\Fp\web\src\features\onboarding\pages\OnboardingWizard.tsx` — wizard 4 خطوات + 37 نشاط + 8 أقسام accordion ✅
- `C:\Fp\web\src\app\[locale]\onboarding\page.tsx` — route للـ wizard ✅

## Design Tokens المطبقة
- Primary: #0C447C | Brand2: #1565C0 | Brand3: #2671C4
- Navbar gradient: #082F5C → #0C447C → #1761B8
- Border radius: card=20px (rounded-md) | small=14px (rounded-sm)
- CSS variables: --brand-primary, --surface-*, --glass-*, --text-*, --shadow-*
- Dark mode: class-based عبر useThemeStore

## ملاحظات تقنية
- StatCard يدعم sparkline SVG inline (zero deps) + theme dashboard/superadmin
- DashboardSidebar: RTL/LTR + role-based filtering + glass effect
- LandingPage: public route + scroll reveal (IntersectionObserver) + auth modal → redirect للـ login/register
- OnboardingWizard: i18n كامل + accordion sections + VAT toggle + progress bar + RTL/LTR chevrons
- Tailwind colors مربوطة بـ CSS variables مباشرة

## المتبقي (المرحلة الرابعة)
- Animations polish (Framer Motion)
- Responsive fixes إضافية
- business_type dynamic UI (sidebar/feature filtering per tenant type)
# 27. LANDING PAGE V2 POLISH — June 23, 2026

## المهمة
مطابقة الـ Landing Page مع الـ prototype الكامل + إصلاح مشاكل RTL + إضافة language switcher + تحديث Login page

## ما تم إنجازه

### LandingPage.tsx ✅
- إعادة بناء كاملة تطابق الـ HTML prototype بالكامل
- Navbar: gradient صحيح + RTL/LTR me-auto fix + language switcher (desktop + mobile)
- Hero: badge + title gradient + dashboard preview mockup + float badges + animations
- Trust/Stats section: 4 stats مع gradient text
- Features: 6 بطاقات مع icons + hover effects
- Business Types: 6 أنواع مع colored icons
- Pricing: 3 خطط (Starter / Pro featured / Enterprise) + animated gradient border
- Testimonials: 3 آراء مع stars + quote mark
- CTA section: gradient background + grid overlay
- Footer: 4 columns + social icons + legal links
- Auth Modal: login / signup / forgot — 3 steps مع Google + Apple + form validation
- LangSwitcher component مستقل

### LoginPage.tsx ✅
- تطبيق Design System V2 (light background + card + brand colors)
- زر تغيير اللغة في الزاوية
- Grid background decoration
- Back to home link
- نفس الـ form logic (react-hook-form + zod + authApi)

### Translation Files ✅
- `ar.json` و `en.json` — حذف duplicates كاملة
- إضافة كل keys الـ landing جديدة: trust.*, business.*, testimonials.*, hero.badgePill/titleGrad/notes/salesGrowth/ordersToday, pricing.starterPrice/proPrice/entPrice/save/sar, auth.loginSub/registerSub/forgotTitle/forgotSub/rememberMe/forgot/forgotBtn/backToLogin/nextStep/or, footer كامل

## ملاحظات تقنية
- LangSwitcher يستخدم usePathname().replace(`/${locale}`, `/${next}`)
- me-auto بدل ms-auto في nav links لضمان RTL صحيح
- Modal يستخدم insetInlineEnd للـ icons (RTL-aware)
- LoginPage لا تستخدم dark mode — light only (landing context)
- Google/Apple buttons في الـ modal — UI فقط، لا ربط حقيقي (backend لا يدعم OAuth حالياً) 
# 28. DYNAMIC BUSINESS TYPE UI — June 23, 2026

## المهمة
إضافة business_type للـ JWT payload + dynamic sidebar filtering per tenant type

## ما تم إنجازه

### Backend ✅
- `jwt-payload.type.ts` — إضافة `business_type: string | null`
- `auth.service.ts` — دالة `getTenantBusinessType()` تسحب من tenants table
- `auth.service.ts` — إضافة business_type في login() + refresh() + me()

### Frontend ✅
- `auth.store.ts` — إضافة BusinessType type + business_type في AuthUser
- `auth.api.ts` — إضافة business_type في LoginResponse + MeResponse
- `auth.provider.tsx` — يمرر business_type في setAuth
- `use-auth.ts` — يمرر business_type في setAuth
- `LoginPage.tsx` — يمرر business_type في setAuth
- `business-type.config.ts` — config جديد لكل 6 أنواع (sidebar items per type)
- `useBusinessType.ts` — hook جديد يقرأ business_type من auth store
- `DashboardSidebar.tsx` — filtering مزدوج: role + business_type
- `DashboardLayout.tsx` — تمرير open prop للـ sidebar

### Bug Fix ✅
- `ReportsAuditPage.tsx` — استبدال 'last_12_months' بـ '12m' (AnalyticsPeriod type)

## الملفات الجديدة
- `C:\Fp\web\src\shared\config\business-type.config.ts`
- `C:\Fp\web\src\shared\hooks\useBusinessType.ts`

## ملاحظات تقنية
- business_type يأتي من JWT مباشرة — لا API call إضافية
- superadmin: business_type = null (لا tenant)
- fallback: 'retail' إذا كان null
- ~~services/workshop: لا pos في sidebar (لا حاجة لـ POS في هذه الأنواع)~~ — **مُبطَل صريحًا من المستخدم بـ§45 (June 26, 2026)**: "نقطة البيع يجب أن تكون في الجميع دون استثناء، أهم ميزة بشراء النظام بالكامل". POS يبقى متاحًا لكل الأنشطة بلا استثناء، لا تمييز هنا أبدًا
- npx tsc --noEmit: 0 أخطاء في api و web ✅
# 29. UPCOMING TASKS — June 23, 2026

## الترتيب حسب الأهمية

| # | التاسك | الأولوية | الحالة |
|---|--------|----------|--------|
| 1 | Dashboard Layout Fix — الـ sidebar يتداخل مع المحتوى، مطابقة الـ prototype كاملاً | 🔴 قصوى | ⬜ |
| 2 | Fix Password Eye Icon — إصلاح موضع أيقونة إظهار/إخفاء كلمة المرور | 🔴 عالية | ⬜ |
| 3 | Landing Page Refactor — حذف popup، أزرار تروح مباشرة لـ /login أو /register | 🔴 عالية | ⬜ |
| 4 | Fix SuperAdmin Arabic Encoding — النصوص العربية مكسورة في صفحات SuperAdmin | 🔴 عالية | ⬜ |
| 5 | Onboarding Route Fix — ربط wizard الـ onboarding بعد التسجيل | 🟡 متوسطة | ⬜ |
| 6 | Feature/Settings Audit — بناء صفحة الإعدادات الكاملة | 🟡 متوسطة | ⬜ |
| 7 | Sidebar Links Fix — إصلاح الروابط المكسورة في الـ sidebar | 🟢 منخفضة | ✅ (راجع §43) |
# 30. DASHBOARD LAYOUT FIX SESSION — June 24, 2026

## ما تم إنجازه

### Backend — endpoints جديدة ✅
- `GET /reports/top-items` — أكثر المنتجات مبيعاً
- `GET /reports/recent-activity` — آخر النشاطات (orders + low stock alerts)
- `GET /reports/sparklines` — بيانات 7 أيام لكل metric

### Frontend ✅
- `DashboardHeader.tsx` — topbar navy gradient مطابق للـ prototype (66px، logo، search، branch pill، avatar)
- `DashboardSidebar.tsx` — glass effect + subscription card navy gradient + nav items بتصميم الـ prototype
- `DashboardLayout.tsx` — layout structure صح (margin RTL/LTR)
- `DashboardOverview.tsx` — Hero Band + stat cards بـ Recharts sparklines + bar chart + doughnut + recent activity + top items + quick actions
- `reports.api.ts` — types + functions للـ 3 endpoints الجديدة

### إصلاحات ✅
- رمز الريال ⃁ — ثابت في كل الصفحات (tenant.store + formatCurrency)
- ترجمات ناقصة: `header.branch`, `sidebar.planLabel`, `sidebar.trial`
- `CurrentShiftBanner.tsx` — hardcoded `ر.س` استبدل بـ `formatCurrency`

## ملاحظات تقنية
- Recharts `^3.8.1` مستخدم للـ charts (AreaChart, BarChart, LineChart, PieChart)
- Tooltip formatter يستخدم `(v: any)` بسبب Recharts 3 ValueType
- `﷼` (`\uFDFC`) غير مدعوم في IBM Plex Sans Arabic — الحل: `⃁` مباشرة من `@emran-alhaddad/saudi-riyal-font`
# 31. DASHBOARD PAGES POLISH SESSION — June 23, 2026

## ما تم إنجازه

### SuperAdmin Arabic Encoding ✅
- إصلاح النصوص العربية المكسورة في صفحات SuperAdmin عبر `useTranslations('nav')` بدل نصوص hardcoded

### Auth UI ✅
- Eye toggle (إظهار/إخفاء كلمة المرور) مضاف في `LoginPage.tsx` و `AuthModal`
- زر التسجيل (Signup) يوجّه إلى `/onboarding` بدل نموذج التسجيل القديم
- تبسيط نموذج التسجيل داخل الـ modal (تقليل الحقول لصالح الـ onboarding wizard)

## ملاحظات تقنية
- هذه الجلسة مهّدت لاستبدال الـ AuthModal بالكامل بالتنقل المباشر لاحقًا (جلسة Landing Page CTA) ولاستبدال نموذج التسجيل المبسّط بتكامل تسجيل حقيقي عبر API (جلسة 32)

---

# 32. ONBOARDING REGISTRATION & VALIDATION SESSION — June 24, 2026

## ما تم إنجازه

### Landing Page CTA ✅
- أزرار "ابدأ مجاناً" و"تسجيل الدخول" تنتقل مباشرة لـ `/login` أو `/onboarding` — حذف `AuthModal` بالكامل من `LandingPage.tsx`

### Onboarding Wizard — تصميم ✅
- إعادة تصميم الصفحة بالكامل لتطابق هوية Landing Page (header navy gradient + grid background + glass card)
- إضافة حقل كلمة المرور (مع زر إظهار/إخفاء)
- جميع الحقول إجبارية (`*`) مع رسائل خطأ حمراء فورية (`showErrors` state + `isStepValid()`)

### Real Registration Integration ✅ (لا بيانات وهمية)
- `POST /auth/register` — endpoint جديد بالكامل في `auth.controller.ts` + `auth.service.ts`
- `RegisterDto` جديد مع تحقق صيغة حقيقي (`class-validator`)
- ينشئ tenant + user + branch + subscription حقيقية في Supabase — لا mock
- عند فشل أي خطوة insert: حذف tenant (cascade ينظّف باقي الجدول) — لا بيانات يتيمة
- تم التحقق المباشر عبر curl ضد production (201 + رؤية الصفوف في Supabase) ثم حذف بيانات الاختبار

### تحقق صيغة حقيقي (Phone + Email) ✅
- Backend: `@Matches()` على phone (صيغة دولية) + `@IsEmail()` + regex إضافي على email
- Frontend: نفس regex + رسائل خطأ مخصصة (`phoneInvalid` / `emailInvalid`)
- رمز الدولة: قائمة منسدلة (دول عربية + عالمية) مدمجة مع حقل الرقم في صندوق واحد
- الحقل ثابت LTR دائمًا (رمز الدولة يسار حتى بالعربي) — placeholder `5xxxxxxxx` بدل `05xxxxxxxx`

### إصلاح خطأ "حدث خطأ أثناء إنشاء الحساب" ✅
- السبب الجذري (من Railway logs): كلمة المرور لم تُفحص لطولها في الواجهة (فقط non-empty) — تفشل الفحص النهائي في الـ API بصمت
- الحل: تحقق فوري من طول كلمة المرور (8 أحرف) في الخطوة الأولى

### Activity Step Redesign ✅
- استبدال الـ accordion البسيط بكاردات لكل قسم نشاط (أيقونة مميزة لكل قسم عبر SECTION_ICONS)
- عند فتح القسم: النشاطات الفرعية تظهر كـ chips داخل الكارد
- القسم المختار يُبرز بخلفية متدرجة + حد أزرق + علامة ✓

## ملفات تم تعديلها/إنشاؤها
- C:\Fp\api\src\modules\auth\dto\register.dto.ts (جديد)
- C:\Fp\api\src\modules\auth\auth.service.ts — register() + ACTIVITY_SECTION_TO_BUSINESS_TYPE
- C:\Fp\api\src\modules\auth\auth.controller.ts — POST /auth/register
- C:\Fp\web\src\features\auth\api\auth.api.ts — RegisterDto + register()
- C:\Fp\web\src\features\auth\hooks\use-auth.ts — useRegister()
- C:\Fp\web\src\features\onboarding\pages\OnboardingWizard.tsx — إعادة بناء كاملة
- C:\Fp\web\messages\ar.json / en.json — مفاتيح onboarding جديدة

## معلّق — بانتظار توضيح المستخدم
- طلب: "الداشبورد يطابق بروتوتايب ويكون Responsive" — لم يُرفق ملف/رابط التصميم المطلوب، ويتعارض مع تجميد الفرونت إند في CLAUDE.md حتى اكتمال Phase A+B

## ملاحظات تقنية
- ON DELETE CASCADE من users/branches/subscriptions → tenants(id) مستخدَم عمدًا في cleanup عند فشل التسجيل
- class-validator مع forbidNonWhitelisted: true — أي حقل زائد في الـ payload يرفض الطلب بالكامل

---

# 33. DASHBOARD RESPONSIVE + DARK MODE + LOGOUT SESSION — June 24-25, 2026

## ما تم إنجازه

### تنظيف i18n للعملة ✅
- مفتاح `currency` الثابت في `messages/ar|en/customers.json` و `ar|en/items.json` كان غير مستخدم فعليًا (الجداول تقرأ من `useTenantStore` مباشرة) وكان مكرر بنص عربي حتى في النسخة الإنجليزية — تم حذفه من الأربع ملفات
- `VariantsModal.tsx` كان الاستثناء الوحيد الذي يستخدم المفتاح الثابت فعليًا — تم ربطه بـ `useTenantStore(s => s.currency_symbol)` بدل النص الثابت

### زر تسجيل الخروج ✅
- لم يكن موجودًا بالداشبورد (تينانت) أبدًا — أُضيف منيو منسدل على صورة المستخدم بالهيدر (الاسم + الإيميل + زر تسجيل الخروج عبر `useLogout`)
- **باگ مكتشف وتم حله**: المنيو كان يُقص (`clipped`) لأن الهيدر فيه `overflow: hidden` — الحل: عرض المنيو عبر React Portal (`createPortal` إلى `document.body`) بموضع `fixed` محسوب من `getBoundingClientRect()` لزر الصورة، مع تحديد (`clamp`) حتى لا يخرج عن الشاشة على الموبايل

### توحيد الهوية البصرية (Brand Color) ✅
- كل الأزرق العام لـ Tailwind (`blue-600`/`blue-500`/`blue-700`...) في صفحات الداشبورد (بوس، الطلبات، المنتجات، العملاء، المصروفات، الشيفتات، التقارير، المستخدمين، الإعدادات) استُبدل بلون البراند الفعلي `#0C447C` — 29 ملف
- رسم بياني الإيرادات بالتقارير (`recharts` Bar) كان بلون أزرق عام، صار بلون البراند

### تجاوب الجداول على الموبايل ✅
- كل الجداول التي كانت تتطلب سحب أفقي لرؤية النصف الآخر (`overflow-x-auto` + `min-w-[...]`) حُوّلت لعرض بطاقات عمودية (`md:hidden` بطاقة / `hidden md:block` جدول) على: `ItemsTable`, `CustomersTable`, `OrdersTable`, `UsersPage`, `ShiftsList`, `ExpensesList`, `CategoriesList`, `TemplatesList`
- `TemplatesList` (الأعقد — قوالب متكررة بحقول select تفاعلية) تم تقسيمها لـ `TemplateCard` (موبايل) + `TemplateRow` (ديسكتوب) عبر hook مشترك `useTemplateRowState` — لتجنب وضع `<div>` داخل `<tbody>` (HTML غير صالح)

### إصلاح ارتفاع صفحة بوس (جدول المنتج كان يمتد للأسفل بلا حدود) ✅
- **السبب الجذري الأول**: `<main>` في `DashboardLayout.tsx` كان له `minHeight` فقط لا `height` ثابت — `h-full` بداخله لا يعمل بدون ارتفاع أب محدد. الحل: `height: calc(100vh - 66px)` + `overflowY: auto` على `main`
- **السبب الجذري الثاني (بعد الإصلاح الأول لم يكفِ)**: عناصر flex المتداخلة (الصف الرئيسي → حاوية الشبكة → الشبكة القابلة للتمرير → السلة) كانت تفتقد `min-h-0` — افتراضيًا متصفحات تطبّق حد أدنى تلقائي للارتفاع = حجم المحتوى، فيتجاوز أي حاوية محدودة. أُضيف `min-h-0` على كل مستوى بالسلسلة (`POSPage`, `ItemGrid`, `CartPanel`)

### بطاقات إحصائيات العملاء على الموبايل ✅
- كانت `grid-cols-3` بلا أي breakpoint فتضغط 3 بطاقات بصف واحد ضيق جدًا على الموبايل — صارت `grid-cols-1 sm:grid-cols-3`

### الوضع الداكن (Dark Mode) — كان غير مكتمل ✅
- **السبب**: خلفية الصفحة الرئيسية (`DashboardLayout.tsx`) وخلفية/ألوان السايدبار (`DashboardSidebar.tsx`) كانت قيم CSS ثابتة (`inline style`) للوضع الفاتح فقط، بدون أي فرع للوضع الداكن — بعكس الكروت والنصوص الداخلية التي كانت بالفعل تستخدم `dark:` classes بشكل صحيح. النتيجة: عند تفعيل الوضع الداكن، الكروت تتغير لكن خلفية الصفحة والسايدبار يبقيان فاتحين → مظهر "متشوّه" نص فاتح/غامق متضارب
- الحل: ربط كلا الملفين بـ `useThemeStore` وتفريع كل الألوان المتأثرة (خلفية الصفحة، خلفية السايدبار الزجاجية، ألوان نصوص الـ nav، hover states) بين فاتح/داكن

## ملفات تم تعديلها
- `messages/ar|en/customers.json`, `messages/ar|en/items.json` — حذف مفتاح `currency` الثابت
- `src/features/items/components/VariantsModal.tsx` — قراءة العملة من المتجر
- `src/features/dashboard/components/DashboardHeader.tsx` — منيو تسجيل الخروج + portal
- 29 ملف عبر `features/{pos,orders,items,customers,expenses,shifts,reports,users,settings}` — توحيد لون البراند
- `src/features/{items,customers,orders}/components/*Table.tsx`, `src/features/users/pages/UsersPage.tsx`, `src/features/shifts/components/ShiftsList.tsx`, `src/features/dashboard/expenses/components/{ExpensesList,CategoriesList,TemplatesList}.tsx` — تحويل لبطاقات موبايل
- `src/features/dashboard/components/DashboardLayout.tsx` — ارتفاع `main` + خلفية الوضع الداكن
- `src/features/pos/page/POSPage.tsx`, `src/features/pos/components/{ItemGrid,CartPanel}.tsx` — `min-h-0` بكل السلسلة
- `src/features/customers/pages/CustomersPage.tsx` — شبكة الإحصائيات متجاوبة
- `src/features/dashboard/components/DashboardSidebar.tsx` — دعم الوضع الداكن

## ملاحظات تقنية
- نمط مكرر لاكتشافه عدة مرات هذا الجلسة: مكوّن له `dark:` classes على المحتوى الداخلي لكن أب أعلى (هيدر/سايدبار/خلفية الصفحة) بـ `inline style` ثابت — يجب فحص كل الأباء عند أي شكوى "الوضع الداكن متشوّه"
- قاعدة flexbox: أي عنصر flex متداخل يُفترض أن "يتمرر داخليًا" (`overflow-y-auto`) يحتاج `min-h-0` (أو `min-height: 0`) صريحًا على كل مستوى بالسلسلة — الاعتماد على `overflow-hidden` فقط بالأب غير كافٍ في كل المتصفحات

---

# 34. PHASE 10A — SCHEMA BUGS AUDIT SESSION — June 25, 2026

## ما تم إنجازه

### تدقيق SCHEMA_DECISION_MATRIX.md — 5 من 6 تضاربات كانت مُصلَحة فعليًا ✅
- فحص مباشر للكود (لا اعتماد على الوثيقة فقط) كشف أن التضاربات A، B، C، D، E، F كلها مُصلَحة بالفعل في commit `745ca84` ("fix: security & bug remediation - 80 issues closed") من جلسة سابقة لم تُحدَّث الوثيقة بعدها
- A: `stripe-webhook.controller.ts` يستخدم `.from('invoices')` بشكل صحيح بالفعل (لا `billing_invoices`)
- B: `dunning.service.ts` يقرأ/يكتب `total_amount` بشكل صحيح بالفعل (لا `amount_due`)
- C/D: `tenants.repository.ts` يربط (`JOIN`) `plans(max_users, max_branches)` ويستخدم `current_period_end` بشكل صحيح
- E: `dunning.service.ts` يكتب `attempted_at` على كل INSERT بالفعل
- F: `grace_period_ends_at` مكتوب بشكل صحيح (موسوم "H-026 FIXED" بتعليق بملف الـ migration)

### الباگ الحقيقي المتبقي: `expenses.shift_id` لا يُكتب أبدًا ✅ تم الإصلاح
- العمود موجود بالجدول من البداية — السبب الجذري: `expenses.service.ts create()` يبني كائن الإدراج يدويًا (بدون استخدام `ExpenseEngine` الموجود أصلاً!) ولا يتضمن `shift_id` مطلقًا
- الأثر: `shifts.repository.ts getShiftExpenses()` (المستخدمة في ملخص إقفال الشيفت لمطابقة النقدية) كانت تُرجع دائمًا مصفوفة فاضية — أي مصروف يُسجَّل خلال شيفت مفتوح لا يظهر أبدًا في تسوية الكاش عند إغلاقه
- الحل (يحافظ على حدود الموديولات — expenses module لا يستعلم جدول shifts مباشرة): إضافة `shift_id?` اختياري لـ `CreateExpenseDto` (الـ API)، الواجهة (`AddExpenseModal.tsx`) ترسل `shift_id` من `useCurrentShift()` الموجود مسبقًا عند إنشاء المصروف

## ملفات تم تعديلها
- `api/src/modules/expenses/dto/create-expense.dto.ts` — حقل `shift_id` اختياري جديد
- `api/src/modules/expenses/expenses.service.ts` — `create()` يكتب `shift_id` الآن
- `web/src/features/dashboard/expenses/api/expenses.api.ts` — `CreateExpenseDto` (واجهة الويب) + حقل `shift_id`
- `web/src/features/dashboard/expenses/components/AddExpenseModal.tsx` — يقرأ `useCurrentShift()` ويرسله

## معلّق
- لم يُختبَر على production بعد (يحتاج: فتح شيفت → تسجيل مصروف → إغلاق الشيفت → التأكد أن المصروف يظهر بملخص التسوية)
- لاحظ: `ExpenseEngine.buildExpenseRequest()` (الموجود بـ `engines/expense-engine/`) غير مُستخدَم أبدًا في `expenses.service.ts` — الخدمة تبني الإدراج يدويًا مباشرة، مخالفة جزئية لقاعدة "Engines هي طبقة منطق الأعمال" (الانتهاك هنا عكسي: المنطق موجود في الـ engine لكن غير مُستهلَك، لا تكرار خطر، لكن يستحق تنظيف لاحقًا)

## ملاحظات تقنية
- SCHEMA_DECISION_MATRIX.md (وربما وثائق تدقيق أخرى مشابهة) قد تكون قديمة (stale) — الفحص المباشر للكود الحالي عبر `grep`/قراءة الملفات أوثق دائمًا من الوثائق التاريخية قبل افتراض وجود باگ
- نمط مفيد لإصلاحات تحترم حدود الموديولات: عندما يحتاج موديول بيانات من موديول آخر (هنا: expenses تحتاج shift الحالي)، الخيار الصحيح هو تمريرها من الـ caller (الواجهة) بدل استعلام جدول الموديول الآخر مباشرة من الباك إند

---

# 35. PHASE 9F — GO-LIVE CHECKLIST AUDIT — June 25, 2026

## ما تم فحصه (سلوكيًا عبر curl ضد production/staging الحقيقيين، لا افتراضات)

### HTTPS ✅
- API و Frontend كلاهما HTTPS مع `Strict-Transport-Security` (HSTS)
- طلب HTTP عادي على API يحوّل تلقائيًا 301 → HTTPS

### Endpoints على production ✅
- تسجيل/دخول حقيقي ناجح (201/200)، بيانات خاطئة بصيغة صحيحة → 401 (لا تسريب معلومات، لا 500)
- مسارات محمية بدون توكن → 401 صحيح (`/branches`, `/superadmin/health`)
- `/metrics` عام بدون توكن (200) — متوافق مع التصميم المعلن بـ CLAUDE.md
- CORS: preflight من origin غير معروف لا يحصل على `access-control-allow-origin` — المتصفحات تمنعه فعليًا. لا `@Put()` routes بالكود فتطابق `methods` المسموحة (`GET,POST,PATCH,DELETE,OPTIONS`) كاملة

### عزل Staging/Production — نتيجة مختلطة ⚠️
- ✅ `JWT_SECRET` مختلف فعليًا بين البيئتين (تحقّقت مباشرة: توكن production مرفوض 401 على staging)
- ⚠️ **خطر حقيقي موجود ومُوثَّق مسبقًا لكن يستحق تسليط الضوء**: staging يتصل بنفس Supabase DB الخاصة بـ production (قرار معماري سابق بـ §"Staging Strategy"). تحقّقت عمليًا: حساب أُنشئ على production نجح تسجيل دخوله على staging API وحصل على جلسة صالحة بنفس بيانات production الحقيقية. يعني أي ثغرة/كود تجريبي غير مستقر على staging قد يكتب على بيانات production الحقيقية بلا حماية إضافية
- اكتشاف جانبي: staging يشغّل نسخة كود **أقدم** من production — `/auth/register` غير موجود هناك (404) بينما موجود على production. الكود غير مُزامَن بين البيئتين

### Environment Variables — لا يمكن فحص Railway dashboard مباشرة (بلا صلاحية وصول)
- فحصت السلوك الفعلي بدلاً من ذلك: استدعاء `/webhooks/stripe` على production يرد `"Stripe is not configured"` → يعني `STRIPE_SECRET_KEY` غير مضبوط حاليًا على production (أو `PAYMENT_PROVIDER=mock` فعّال) — **يحتاج تأكيد المستخدم**: مقصود قبل البدء بقبول مدفوعات حقيقية، أم فجوة نسيان؟

### RUNBOOK.md — فجوة حقيقية ❌
- غير موجود في المشروع نهائيًا (لا الملف ولا أي نسخة سابقة) — يحتاج كتابة من الصفر قبل إعلان Go-Live

### Cloudflare WAF — ليست فجوة، قرار مؤجل عمدًا
- موثّق مسبقًا بـ §"WAF Strategy": مؤجل حتى شراء domain خاص؛ الحماية الحالية (Helmet + Rate Limiting + HSTS + CORS) كافية مؤقتًا

## التنظيف بعد الاختبار
- أُنشئت 2 تينانتات تجريبية مؤقتة (production مرة، staging/production المشتركة مرة) لاختبار العزل والمصروفات — كلاهما محذوف بالكامل عبر service-role key مباشرة بعد التحقق (`DELETE FROM tenants WHERE id = ...` → cascade)، وتأكدت من الحذف بمحاولة دخول فاشلة (401)

## قرارات اتُّخذت بعد المراجعة مع المستخدم ✅

### Stripe — مقصود، لا فجوة
المستخدم أكّد: `PAYMENT_PROVIDER=mock` مقصود بهذه المرحلة — لا نستقبل مدفوعات حقيقية بعد. لا فعل مطلوب.

### Staging — كان متروكًا وغير مستخدَم فعليًا → تم حذفه
- تحقّق إضافي: فرع `staging` على GitHub آخر كومت له **2026-06-09** (متأخر 16 يومًا عن `main`) — يؤكد أنه غير مُستخدَم فعليًا في التطوير الجاري
- القرار: حذف بدل الفصل (لأنه غير مهم فعليًا، ليس مجرد خطر يستحق استثمار فصله)
- تم تنفيذ ما هو بصلاحياتي:
  - حذف `.github/workflows/staging.yml` (commit `aec829c`، مدفوع لـ `apiv1.0.2`)
  - حذف فرع `staging` من remote (`git push origin --delete staging`)
- **معلّق على المستخدم (خارج صلاحيات الأدوات المتاحة)**: حذف خدمة `sefay-api-staging-production` نفسها من لوحة Railway يدويًا — تبقى تعمل حاليًا وتستهلك تكلفة بلا فائدة حتى يُحذف

## معلّق — يحتاج فعل المستخدم
1. حذف خدمة staging من Railway dashboard يدويًا — ✅ المستخدم أكّد الحذف
2. كتابة `RUNBOOK.md` — ✅ تم (راجع §36)

**Phase 9F مكتملة بالكامل.**

---

# 36. RUNBOOK.md + PHASE 10B GROUNDWORK SESSION — June 25, 2026

## RUNBOOK.md ✅
كُتب من الصفر — البنية التحتية، env vars المطلوبة مع شرح أثر كل واحد عند غيابه، health check endpoints (العام والمحمي)، إجراءات النشر (لاحظ: `start:prod` يشغّل seed الصلاحيات تلقائيًا قبل كل إقلاع)، الـ rollback لكل من Railway وVercel، حوادث شائعة موثّقة (تغيّر JWT_SECRET يُسقط كل الجلسات، فشل بريد صامت، Stripe webhook 400 متوقع حاليًا)، وملاحظة عن حذف staging.

## Phase 10B — طرق الدفع المتعددة: تجهيز نموذج البيانات فقط (مؤجلة كميزة فعلية)
المستخدم طلب صريحًا: "مؤجلة لكن نجهزها للربط مستقبلاً" — لا بناء تكامل بوابات دفع حقيقي (Moyasar/Tap)، فقط توسعة نموذج البيانات لاستقبال القيم الجديدة بلا حاجة لـ migration ثانية لاحقًا.

### ما تم
- اكتشاف: عمود `orders.payment_method` بقاعدة البيانات كان أصلاً يسمح بقيمة `wallet` (CHECK constraint) لم تكن مستخدَمة أبدًا من الكود — DTO كان يحصرها بـ `cash/card/split` فقط
- migration جديدة `006_expand_payment_methods.sql` (تُحدِّد اسم القيد الفعلي ديناميكيًا عبر `pg_constraint` بدل افتراض اسمه — أكثر أمانًا من migration `005`) — أضافت: `mada, visa, mastercard, stc_pay, apple_pay, tab` — **مطبّقة فعليًا على production** (`npm run migrate`)
- `CreateInvoiceDto.payment_method` وسّع لتقبل القيم الجديدة
- `invoices.service.ts`: إضافة تحقق بسيط — `tab` يتطلب `customer_id` إلزاميًا (يمنع فاتورة "حساب مفتوح" بلا عميل تُحمَّل عليه — لا نظام AR/محاسبة ديون كامل، فقط الوسم وربطه بعميل، نطاق محدود ومقصود)
- **لم يُعدَّل**: `PaymentModal.tsx` (واجهة الكاشير) — عمدًا، تجنّبًا لعرض خيارات (Mada/Visa/...) بلا فرق وظيفي فعلي حاليًا (كلها تُعامَل كـ"card" فعليًا، الكاشير يسجّلها فقط كوسم لاحقًا عند بناء واجهة فعلية لها)
- **لم يُبنَ**: أي abstraction/interface لبوابات Moyasar/Tap — تجنّبًا لتصميم سابق لأوانه (premature abstraction) قبل معرفة الشكل الفعلي لـ API كل بوابة

### اختبار حقيقي على production ✅
تينانت تجريبي → عنصر → فاتورة بـ `payment_method=mada` (نجحت بعد نشر الكود) → فاتورة بـ `tab` بلا `customer_id` (رفضت 400 برسالة واضحة) → فاتورة `tab` مع `customer_id` (نجحت) → `GET /reports/revenue` أظهر `by_payment_method: {mada:..., tab:...}` **تلقائيًا بلا أي تعديل بكود التقارير** (التجميع ديناميكي على القيمة الفعلية بالعمود) → تنظيف التينانت التجريبي بالكامل

### فجوة جانبية مكتشفة أثناء التنظيف (أُرسلت كـ background task منفصل، لم تُصلَح هنا)
`order_items.item_id` و`order_items.variant_id` بلا `ON DELETE` (تُحجب بـ RESTRICT افتراضيًا) — حذف تينانت له طلبات حقيقية فعليًا قد يفشل عبر cascade من `tenants→items` بينما `order_items` لا تزال تشير لنفس الـ items. أُرسل كـ task منفصل (`task_29163512`) لإصلاحه بـ migration `SET NULL` لاحقًا — خارج نطاق هذه الجلسة عمدًا.

## ملفات تم تعديلها
- `api/src/database/migrations/006_expand_payment_methods.sql` (جديد)
- `api/src/modules/invoices/dto/create-invoice.dto.ts`
- `api/src/modules/invoices/invoices.service.ts`
- `RUNBOOK.md` (جديد)

---

# 37. FIX — order_items FK RESTRICT-by-default SESSION — June 25, 2026

## المشكلة (مكتشفة في §36، أُصلحت هنا)
`order_items.item_id` و `order_items.variant_id` بدون `ON DELETE` صريح (يعني RESTRICT افتراضي من Postgres). أي حذف فعلي (hard delete) لتينانت له طلبات حقيقية يفشل: `tenants → items` (CASCADE موثّق) يحاول حذف `items`، لكن `order_items` لا تزال تشير لنفس الـ items فيرفض Postgres بـ:
```
update or delete on table "items" violates foreign key constraint "order_items_item_id_fkey" on table "order_items"
```

## تصحيح مهم على التقرير الأصلي
نقطة الدخول الوحيدة في endpoint السوبرادمن (`DELETE /superadmin/tenants/:id` → `superadmin.controller.ts` → `lifecycle.service.ts softDelete()` → `repo.softDelete()`) هي **soft delete فقط** (يكتب `deleted_at`، لا hard delete، لا cascade). الـ endpoint هذا **لا يتأثر** بهذه المشكلة أبداً. المشكلة الحقيقية فقط عند حذف فعلي مباشر عبر service-role SQL (`DELETE FROM tenants WHERE id = ...`) — وهو فعلاً ما حدث أثناء تنظيف تينانت QA في §36 و §35. لا يوجد حالياً أي مسار كود في التطبيق يقوم بـ hard delete لتينانت — فقط الاستخدام اليدوي المباشر بصلاحية service-role.

## الحل
`migration 007_fix_order_items_fk_on_delete.sql` — تعثر على اسم الـ FK constraint الفعلي ديناميكياً عبر `pg_constraint`/`pg_attribute` (نفس نمط migration 006) ثم تُسقطه وتعيد إنشاءه بـ `ON DELETE SET NULL` على كل من `item_id` و `variant_id`. **SET NULL وليس CASCADE** — حذف منتج لا يجب أن يحذف سجلات طلبات تاريخية (قاعدة "السجلات المالية غير قابلة للتغيير" في CLAUDE.md)؛ العمودان أصلاً nullable.

**مطبّقة فعلياً على production** (`npm run migrate`).

## التحقق
1. استعلام مباشر على `pg_constraint.confdeltype` بعد الـ migration أكّد: `item_id` → `n` (SET NULL)، `variant_id` → `n` (SET NULL)، `order_id` بقي `c` (CASCADE) كما هو مصمَّم.
2. اختبار حقيقي على production كامل (نفس نمط §35/36): تسجيل تينانت تجريبي حقيقي (`/auth/register`) → إنشاء فرع (تلقائي من التسجيل) → إنشاء item حقيقي → إنشاء فاتورة (`POST /invoices`) تحتوي `item_id` لهذا الـ item → حذف فعلي مباشر للتينانت عبر service-role SQL (`DELETE FROM tenants WHERE id = ...`) — **نجح بدون أي خطأ** (قبل الإصلاح كان هذا بالضبط السيناريو الذي يفشل). تأكدت من الحذف الكامل بمحاولة دخول فاشلة (401 Invalid credentials) على نفس الحساب التجريبي.

## ملفات تم تعديلها
- `api/src/database/migrations/007_fix_order_items_fk_on_delete.sql` (جديد)

---

# 38. FIX — Recurring Expenses Scheduler كانت dead code فعليًا — June 25, 2026

## السياق
طلب المستخدم متابعة العمل من TASKS.md/STATUS.md، لاحظ تضاربًا: "الوضع الحالي" بـ TASKS.md يضع `Recurring Expenses Scheduler` كـ ⬜ بعده، بينما §25 (June 22, 2026) توثّق الميزة كمكتملة بالكامل بما فيها "Cron يومي 00:00 في `expenses.scheduler.ts`". طلب تصحيح أي تضارب حقيقي بدل افتراض أي طرف صحيح.

## الفحص — التضارب كان حقيقيًا، §25 كانت غير دقيقة
- `expenses.service.ts:288` يحتوي `processRecurringExpenses()` مبني بالكامل وصحيح (يقرأ `expense_templates` المستحقة عبر `next_run_at <= now`، ينشئ `expenses`، يحدّث `next_run_at` التالي عبر `calculateNextRun()`)
- لكن `expenses.scheduler.ts` كان يحتوي **فقط** على `@Cron(CronExpression.EVERY_HOUR)` لـ `expireStaleExpenses()` — **لا يوجد أي cron يستدعي `processRecurringExpenses()` إطلاقًا**
- يعني: الدالة كانت dead code كاملة منذ بنائها بـ§25 — أي قالب مصروف متكرر بالنظام لن يُنشئ أي مصروف تلقائي أبدًا بالواقع، رغم أن الواجهة (`TemplatesList.tsx`) تتيح تفعيل التكرار وتحسب/ترسل `next_run_at` بشكل صحيح فعليًا (تحققت من الكود — هذا الجزء سليم)
- السبب الجذري الأرجح: تم بناء الـ service method والـ frontend في نفس الجلسة لكن نُسي ربط الـ cron الفعلي، ولم يُكتشف لأن لا اختبار حقيقي انتظر دورة يوم كامل للتحقق

## الإصلاح
أُضيف `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT) handleRecurringExpenses()` في `expenses.scheduler.ts` يستدعي `expensesService.processRecurringExpenses()` — نفس نمط/أسلوب اللوغ الموجود لـ `handleExpiredExpenses()` (نفس الكلاس، نفس الـ Logger).

`npm run build` نجح بدون أخطاء.

## التحقق
- تحقق كود كامل لمسار البيانات (DTO → frontend → DB → service) أكّد أن `next_run_at` يُحسب ويُرسل بشكل صحيح من `TemplatesList.tsx` (`handleRecurrenceChange`/`handleDayChange`) عند أي تغيير recurrence — لا فجوة ثانية بهذا الجزء
- **لم يُختبَر تنفيذ الـ cron الفعلي على production** — cron يومي عند منتصف الليل لا يمكن التحقق منه فوريًا بنفس جلسة العمل (يحتاج انتظار حتى منتصف الليل أو نشر الكود فعليًا أولاً). يُنصَح بمراقبة Railway logs بعد أول منتصف ليل بعد النشر للتأكد من ظهور سطر `[RecurringExpenses]` أو رسالة "Created N expense(s) from recurring templates"
- **لم يُنشَر على production بعد** — التعديل محلي فقط بهذه اللحظة، معلّق على قرار المستخدم بالـ commit/push (الريبو يُنشر تلقائيًا على Railway عند push لـ main)

## ملفات تم تعديلها
- `api/src/modules/expenses/expenses.scheduler.ts`

---

# 39. Phase 10C — Custom Customer Fields (بناء كامل، غير منشور) — June 25, 2026

## السياق
طلب المستخدم البدء بـ Phase 10C. الفئة الفرعية كانت تتضمن نود frontend مباشر (POS Customer Lookup + تسجيل عميل جديد عند البيع) بينما CLAUDE.md يقول "Frontend مجمد حتى اكتمال Phase A+B" — وهما مكتملان فعليًا منذ مدة طويلة (موثّق بـ TASKS.md) وتم بناء عشرات صفحات frontend بعدها (راجع §14-26). سألت المستخدم للتأكيد، لم يصل رد، فاعتُبر السطر القديم في CLAUDE.md غير منطبق فعليًا على الواقع الحالي للمشروع وتمت المتابعة بالنطاق الكامل (DB + API + Frontend) المطلوب فعليًا بقائمة 10C بـ TASKS.md.

## ما تم بناؤه

### DB — migration `008_customer_custom_fields.sql` (مطبّقة فعليًا على production)
- `tenants.customer_capture_enabled BOOLEAN DEFAULT false`
- `customers.custom_fields JSONB DEFAULT '{}'`
- جدول جديد `customer_field_definitions` (tenant_id, field_key, label_ar, label_en, field_type, options, required, is_active, sort_order) — `UNIQUE(tenant_id, field_key)`

### Backend
- `CustomerFieldDefinitionsController/Service/Repository` (وحدة جديدة داخل `modules/customers/`) — `@Controller('customer-field-definitions')` **top-level** عمدًا (لا `customers/field-definitions`) لتجنّب تضارب مع `CustomersController`'s `@Get(':id')` — نفس نمط `expense-templates` الموجود مسبقًا بالمشروع
- `CustomersService` يتحقق من `custom_fields` المُرسلة: يرفض مفاتيح غير معروفة، يتحقق من النوع (number/boolean/select options)، ويُلزم الحقول `required` عند الإنشاء فقط
- بحث العملاء (`GET /customers?search=`) وُسّع ديناميكيًا ليشمل أي حقل مخصّص نشط من نوع text/select عبر `custom_fields->>key.ilike` (الـ keys تُجلب من تعريفات الحقول النشطة فقط قبل البناء، ومضمونة lowercase/snake_case بالـ regex عند التعريف — لا حقن SQL)
- `tenants.customer_capture_enabled` مضاف لـ `UpdateTenantProfileDto` + `TenantsRepository`

### Frontend
- أنواع/API/hooks جديدة: `CustomerFieldDefinition`, `useCustomerFieldDefinitions`, `useCreateFieldDefinition`, إلخ. + `useCustomerSearch(search)`
- `CustomFieldsManager.tsx` (مكوّن جديد) — إدارة الحقول المخصصة (إضافة/تفعيل-تعطيل/حذف) — مدموج بصفحة Settings مع toggle `customer_capture_enabled`
- `CustomerPickerModal.tsx` (مكوّن جديد بـ POS) — بحث عن عميل بأي حقل + نموذج "تسجيل عميل جديد" ديناميكي يعرض الحقول المخصصة النشطة (يُلزم required بالواجهة أيضًا)
- `CartPanel.tsx` + `POSPage.tsx`: عند تفعيل `customer_capture_enabled`، يظهر صف "إضافة عميل" فوق زر الدفع؛ العميل المختار يُمرَّر كـ `customer_id` فعليًا لـ `createOrder` (كان الحقل مدعومًا بالـ backend مسبقًا — `customer_id` موجود بـ `CreateInvoiceDto` من جلسة 10B — لكن لم يكن أي مسار بالـ POS UI يرسله إطلاقًا قبل هذه الجلسة)

## التحقق
- `npm run build` (api) نجح بدون أخطاء
- `npx tsc --noEmit` (web) نجح بدون أخطاء على كامل المشروع
- migration 008 طُبّقت فعليًا على production DB (`npm run migrate`) — إضافات additive فقط (أعمدة جديدة بقيم افتراضية، جدول جديد) لا تكسر أي كود حالي يعمل على production
- **لم يُختبَر end-to-end على production حقيقي بعد** — الكود غير منشور (push لـ main معلّق على قرار المستخدم، نفس قرار §38)
- **لم يُختبَر محليًا أيضًا** — حاولت تشغيل `npm run start:dev` محليًا (بدون push، فقط للتحقق) لكن التطبيق فشل بالإقلاع: Redis غير مشغّل محليًا (`ECONNREFUSED 127.0.0.1:6379`) و BullMQ Queue Infrastructure إلزامية عند الإقلاع (موثّق بـ CLAUDE.md "Redis هو runtime dependency مطلوب")؛ Docker Desktop غير مشغَّل على الجهاز فلم يكن متاحًا تشغيل Redis محليًا بسرعة. تم إيقاف العملية وتنظيف ملف اللوغ المؤقت

## تحديث — نُشر واختُبر فعليًا على production (June 25, 2026)
طلب المستخدم النشر والاختبار الحقيقي. تم:
- `git push` لكل من `api` (Railway) و `web` (Vercel) — كلا الـ deployments نجحا (تأكدت عبر `railway status`/`logs` و `vercel ls`)
- **باغ حقيقي اكتُشف فورًا بعد النشر**: `POST /customer-field-definitions` كان يرجع 500 — نفس فئة مشكلة `expense_categories` السابقة (§15): الجدول الجديد `customer_field_definitions` لم يرث صلاحيات `service_role` تلقائيًا على مشروع Supabase هذا (`permission denied for table customer_field_definitions`, code `42501`). تم تشخيصها بسكربت تصحيح محلي مباشر (مُحذوف بعد الاستخدام) ثم إصلاحها بـ migration جديدة `009_grant_customer_field_definitions.sql` (`GRANT ALL ... TO service_role` + `DISABLE ROW LEVEL SECURITY`) — طُبّقت وأُعيد النشر، نجحت كل العمليات بعدها
- اختبار end-to-end كامل على production حقيقي: تسجيل تينانت → تفعيل `customer_capture_enabled` → إنشاء حقل نصي إلزامي (`national_id`) + حقل select (`gender`) → تأكيد رفض إنشاء عميل بدون الحقل الإلزامي (400) → إنشاء عميل بالحقول الصحيحة → تأكيد رفض مفتاح حقل غير معروف (400) → تأكيد رفض قيمة select غير صالحة (400) → البحث بالاسم/الجوال نجح، **والبحث بقيمة `national_id` وبقيمة `gender` (select) نجح أيضًا** (يؤكد ميزة "Lookup بأي حقل" فعليًا) → تحديث حقل (تعطيل) + حذفه (soft delete) نجحا وانعكسا فورًا بالقائمة → إنشاء فرع/منتج/فاتورة فعلية بـ`customer_id` لنفس العميل → `GET /customers/:id/history` أكّد ظهور الطلب (`orders_count:1`, المبلغ صحيح) — يثبت أن `customer_id` يصل فعليًا من نهاية لنهاية رغم أن مسار POS بالواجهة لم يُختبَر بمتصفح حقيقي (اختُبر منطقه عبر استدعاء نفس الـ API الذي يستدعيه)
- ملاحظة جانبية: ظهر تشويه ترميز عربي بنتائج `curl` الأولى — تحقّقت أنه مجرد عرض/ترميز سطر الأوامر بـ Git Bash على Windows (UTF-8 في الـ command-line args)، وليس فساد بيانات فعلي — أعدت الاختبار بإرسال JSON من ملف UTF-8 حقيقي والنص العربي رجع سليمًا 100% (تأكدت بفحص hex bytes)
- تنظيف كامل: حذف التينانت التجريبي عبر hard delete (نفس مسار §37 — يؤكد أن إصلاح FK لا يزال يعمل) + تأكيد فاشل تسجيل دخول (401)

## باغ ثانٍ حقيقي اكتُشف بعد تقرير المستخدم: "لا تظهر عند الكاشير" — June 25, 2026

### المشكلة
المستخدم فعّل `customer_capture_enabled` وأضاف حقولًا مخصصة من Settings (لقطة شاشة)، لكن الميزة لم تظهر إطلاقًا عند تسجيل الدخول بحساب كاشير فعلي.

### السبب الجذري
دور `cashier` كان ينقصه صلاحيتان:
1. `settings.view` — وهي الصلاحية التي يتطلبها `GET /tenant/profile` (المصدر الذي كانت `POSPage.tsx` تقرأ منه `customer_capture_enabled` و `tax_rate`). بدون هذه الصلاحية، الطلب يرجع 403، والكود يتجاهل الخطأ بهدوء ويستخدم `?? false` — فتُختفي الميزة كاملة عن الكاشير بلا أي رسالة خطأ ظاهرة
2. `customers.manage` — مطلوبة لـ `POST /customers` (تسجيل عميل جديد عند البيع) — الكاشير كان يملك `customers.view` فقط (بحث) وليس الإنشاء

اكتشاف جانبي مهم أثناء التحقيق: **يوجد 3 ملفات seed صلاحيات مختلفة ومتضاربة بالمشروع** (`src/database/seeds/permissions.seed.ts` — وهو الفعلي الذي يُشغَّل تلقائيًا بكل `npm run migrate` و كل إقلاع `start:prod`؛ و `src/seeds/permissions.seed.ts` و `src/seeds/full-setup.seed.ts` — كلاهما غير مرتبط بأي تشغيل تلقائي وتختلف قوائم الصلاحيات فيهما عن الفعلي). تحقّقت من القيم الحقيقية المُطبَّقة على production بسؤال جدول `role_permissions` مباشرة عبر Supabase API بدل الثقة بأي ملف وحده. أُرسل هذا كـ task منفصل للتنظيف (`task_b8029316`) — خارج نطاق هذه الجلسة.

### الإصلاح
1. `src/database/seeds/permissions.seed.ts` (الملف الفعلي): أضيفت `customers.manage` لدور `cashier`
2. endpoint جديد خفيف `GET /tenant/pos-config` (`tenants.controller.ts`) محمي بصلاحية يملكها الكاشير فعليًا (`invoice.create.own`) يرجع فقط `{tax_rate, customer_capture_enabled}` — بدل الاعتماد على `/tenant/profile` المحمي بـ `settings.view`. هذا يحل أيضًا باغًا كامنًا سابقًا غير مرتبط بـ10C: `tax_rate` نفسه كان فعليًا غير قابل للقراءة من الكاشير قبل هذا الإصلاح (كان يتراجع بصمت للقيمة الافتراضية `0.15`)
3. `POSPage.tsx`: التبديل من `/tenant/profile` إلى `/tenant/pos-config`

### التحقق — اختبار حقيقي كامل بدور cashier فعلي على production
تسجيل تينانت (owner) → تفعيل `customer_capture_enabled` + تعريف حقل `plate_id` إلزامي → إنشاء مستخدم بدور `cashier` فعليًا (`POST /users`) → **تسجيل دخول بحساب الكاشير نفسه** (JWT يُظهر `customers.manage` ضمن الصلاحيات بعد الإصلاح) → بكل الاستدعاءات من حساب الكاشير: `GET /tenant/pos-config` (200 ✅) → `GET /customer-field-definitions` (200 ✅) → `GET /customers?search=` (200 ✅) → `POST /customers` بالحقل المخصص الإلزامي (201 ✅) → `POST /invoices` بـ `customer_id` لهذا العميل (201 ✅) — كل ما كان يفشل بصمت (403) قبل الإصلاح أصبح يعمل كاملاً كحساب كاشير حقيقي. تنظيف كامل بعدها (hard delete + تأكيد 401).

## تصحيحان طلبهما المستخدم بعد المراجعة — June 25, 2026

### 1. full_name/phone كانا hardcoded، خلاف ما طلبه المستخدم
المستخدم لاحظ (من لقطة شاشة Settings فعلية بحقول `plate_id`/`mob_num`/`notes`) أن الحقول يجب أن تظهر **حرفيًا كما عرّفها المالك فقط** — لا إضافة تلقائية لاسم العميل/رقم الجوال، والإلزامية تتحدد بالكامل حسب اختيار المالك لكل حقل.

**المشكلة الفعلية بالكود القديم**: `CreateCustomerDto` كان يفرض `full_name`/`phone` كحقلين إلزاميين دائمًا (class-validator)، و `CustomerPickerModal` (نموذج POS لتسجيل عميل جديد) كان يعرضهما كـ inputs منفصلين hardcoded قبل أي حقول مخصصة — بمعزل تام عن نظام `customer_field_definitions`.

**الإصلاح**: `full_name`/`phone` أصبحا الآن مجرد حقلين "أساسيين" (`full_name`, `phone`) ضمن نفس جدول `customer_field_definitions` — يُزرعان تلقائيًا لكل تينانت (lazy، عند أول استدعاء `GET /customer-field-definitions`) بقيمة `required:true` افتراضيًا (للحفاظ على التوافق مع السلوك القديم تلقائيًا)، لكن المالك يستطيع الآن:
- تغيير required لكل منهما (زر جديد "إلزامي/اختياري" أُضيف في `CustomFieldsManager.tsx` لكل الحقول، أساسية أو مخصصة)
- تعطيلهما (is_active) إن لم يحتاجهما إطلاقًا (مثال فعلي مُختبَر: تينانت مغسلة سيارات يسجّل عميل بـ `plate_id` فقط، بلا اسم وبلا جوال إطلاقًا — نجح)
- **لا يمكن حذفهما** (403 — "Cannot delete a built-in field... disable it instead") ولا تغيير نوعهما عن `text` (400) — حماية بسيطة تمنع كسر العمود الفعلي بقاعدة البيانات
- migration `010_customers_full_name_nullable.sql`: `customers.full_name` أصبح nullable (كان NOT NULL) — `phone` كان nullable مسبقًا أصلاً
- `CustomerPickerModal.tsx` (POS): أُعيد بناؤه بالكامل — لا حقول hardcoded إطلاقًا، يعرض كل الحقول النشطة (بما فيها full_name/phone) مرتّبة حسب `sort_order` ديناميكيًا، ويوجّه القيم تلقائيًا (full_name/phone → top-level dto، الباقي → `custom_fields`)
- الإلزامية تتحقق بالكامل من `customer_field_definitions.required` بدل قواعد ثابتة بالكود (`CustomersService.validateFields`)

**التحقق على production**: تينانت جديد → تأكدت أن `full_name`/`phone` يُزرعان تلقائيًا (`sort_order:-2/-1`) → تعطيل required لكليهما + إضافة `plate_id` (إلزامي) و`notes_extra` (اختياري) → إنشاء عميل بـ `plate_id` فقط بلا اسم وبلا جوال (نجح 201، `full_name:null, phone:null`) → إنشاء عميل بلا `plate_id` (رُفض 400 برسالة واضحة) → محاولة حذف الحقل الأساسي `phone` (رُفض 403) → محاولة تغيير نوعه لـ`number` (رُفض 400) → بحث الكاشير عن هذا العميل بقيمة `plate_id` فقط نجح ووجده → فاتورة فعلية كاملة بهذا العميل (`customer_id`) كحساب cashier فعلي حقيقي — نجحت بالكامل (201)

### 2. ترتيب خطوات الكاشير بـ POS كان خاطئًا
المستخدم وصف التدفق الصحيح: إضافة منتجات للسلة → ضغط "دفع" → **عندها** يظهر البحث عن عميل (أو تسجيل جديد إذا غير موجود) → بعد تحديد العميل → اختيار طريقة الدفع → تأكيد الدفع → الفاتورة.

**كان فعليًا**: زر "إضافة عميل" مستقل بالسلة *قبل* الضغط على دفع، يفتح نافذة البحث ثم يغلقها فقط دون الانتقال لشاشة الدفع — خطوتان منفصلتان غير مرتبطتين، يخالف التدفق المطلوب.

**الإصلاح**: ضغط "دفع" الآن:
- إذا `customer_capture_enabled` مفعّل وما زال لا يوجد عميل محدَّد → يفتح نافذة البحث/التسجيل أولًا
- بعد اختيار/تسجيل العميل → ينتقل تلقائيًا لشاشة اختيار طريقة الدفع (`PaymentModal`)
- إذا الميزة غير مفعّلة، أو عميل محدَّد مسبقًا → ينتقل مباشرة لشاشة الدفع كالسابق
- أُزيل زر "إضافة عميل" المستقل بالسلة (كان يخلق سلوكًا مزدوجًا غير متّسق مع التدفق الجديد) — يبقى فقط عرض العميل المحدَّد (مع زر إزالته) إن وُجد

## الخلاصة النهائية
Phase 10C **مكتمل ومُختبر فعليًا على production بدور owner وبدور cashier فعليين**، شامل تصحيحَي المستخدم بعد المراجعة الحقيقية. لم يُختبَر فقط: مسار POS الكامل من متصفح حقيقي (الواجهة) — كل المنطق مثبت عبر استدعاءات الـ API ذاتها التي تستخدمها الواجهة، لكن لم تُشاهَد الشاشة بمتصفح فعليًا.

## ملفات جديدة/معدّلة
- `api/src/database/migrations/008_customer_custom_fields.sql` (جديد)
- `api/src/modules/customers/customer-field-definitions.{controller,service,repository}.ts` (جديد)
- `api/src/modules/customers/dto/{create,update}-field-definition.dto.ts` (جديد)
- `api/src/modules/customers/dto/{create,update}-customer.dto.ts`
- `api/src/modules/customers/customers.{service,repository,module}.ts`
- `api/src/modules/tenants/dto/update-tenant-profile.dto.ts`
- `api/src/modules/tenants/repositories/tenants.repository.ts`
- `web/src/features/customers/types/customer.types.ts`
- `web/src/features/customers/api/customers.api.ts`
- `web/src/features/customers/hooks/useCustomers.ts`
- `web/src/features/customers/components/CustomFieldsManager.tsx` (جديد)
- `web/src/features/settings/api/settings.api.ts`
- `web/src/features/settings/pages/SettingsPage.tsx`
- `web/src/features/pos/components/CustomerPickerModal.tsx` (جديد)
- `web/src/features/pos/components/CartPanel.tsx`
- `web/src/features/pos/page/POSPage.tsx`

# 40. PERMISSIONS SEED CLEANUP (`task_b8029316`) — June 25, 2026

## السياق
أثناء تصحيح باغ "لا تظهر عند الكاشير" بـ §39، اكتُشف وجود 3 ملفات seed صلاحيات متضاربة بالمشروع. أُرسل كـ task منفصل وقتها لتوحيدها. هذه الجلسة أغلقته.

## التحقق قبل أي تعديل
1. `grep` على `package.json` + كل الـ imports بـ `src/`: الملف الفعلي الوحيد المربوط بأي تشغيل تلقائي هو `src/database/seeds/permissions.seed.ts` — مستورد من `migrate.ts` (يشغَّل بكل `npm run migrate`) ومشغَّل مباشرة بـ `start:prod` + `npm run seed:permissions`
2. `src/seeds/permissions.seed.ts` — صفر استدعاءات بأي مكان بالكود (ميت فعليًا)، وأيضًا غير متوافق بنيويًا مع الـ schema الحالي (`onConflict: 'key'` بدل `'name'`، وينقصه عدة صلاحيات مثل `items.view`/`customers.*`/`expenses.view`)
3. `src/seeds/full-setup.seed.ts` — مربوط فقط بـ `npm run seed:full` (تشغيل يدوي بالكامل، لا يشتغل تلقائيًا بأي deploy)
4. **قبل حذف/تعديل أي شيء**: تم استعلام جدول `role_permissions` الفعلي على production مباشرة عبر Supabase Management API (نفس طريقة `migrate.ts`) لصلاحيات دور `cashier` — النتيجة طابقت قوائم الملف الفعلي بالضبط، مع صلاحية إضافية وحيدة (`branches.view`) غير موجودة بأي من الثلاثة ملفات (مُنحت يدويًا خارج أي seed) — upsert لا يحذف صلاحيات غير مذكورة فلا خطر من تشغيل الملف الفعلي عليها

## الإصلاح
- حُذف `src/seeds/permissions.seed.ts` (ميت + غير متوافق)
- `src/database/seeds/permissions.seed.ts`: أصبح يُصدِّر (`export`) `permissions` و `rolePerms` بالإضافة لدالة `seedPermissions()`
- `src/seeds/full-setup.seed.ts`: أُزيلت نسخته المحلية المتضاربة من `permissions`/`rolePerms` (كانت تنقصها لـ cashier: `invoice.view`, `invoice.create`, `expenses.view`, `customers.manage`) — يستورد الآن من الملف الفعلي مباشرة. باقي منطقه (تينانت تجريبي + owner + plan + ...) بقي بدون تغيير
- `npx tsc --noEmit` نجح بدون أخطاء

## النتيجة
مصدر حقيقة واحد فعليًا لصلاحيات الأدوار: `src/database/seeds/permissions.seed.ts`. لم تُمس أي صلاحية حية على production.

## ملفات تم تعديلها/حذفها
- حذف: `api/src/seeds/permissions.seed.ts`
- `api/src/database/seeds/permissions.seed.ts` (export إضافي)
- `api/src/seeds/full-setup.seed.ts`

---

# 41. SuperAdmin Full Light/Dark Theme + Regression Fixes — June 25, 2026

## السياق
طلب المستخدم تحويل كامل لوحة السوبر أدمن لتطابق ثيم لوحة المستأجر 100% (فقط الثيم — لا الإعدادات/الخيارات). أول محاولة كانت سطحية (chrome فقط) فكسرت التباين ("مشوهة"). ثم تم تصحيح زائد (قفل دائم على Dark) ورُفض بشدة من المستخدم: "انا ادري انه داكن ... الحل كامل مطلوب". أُعيد البناء بشكل صحيح: toggle حقيقي + تحويل كل الملفات الفعلي.

## الحل النهائي
- استعادة `useThemeStore` + `ThemeProvider` في `SuperAdminLayout.tsx` (لم يبق مقفولاً على dark)
- تحويل **29 ملف** من dark-only إلى `dark:` variants عبر 4 agents موازية (نفس نمط tenant dashboard: `bg-white dark:bg-gray-900`, `text-slate-800 dark:text-white`, إلخ) — كل صفحات/كومبوننتات tenants/subscriptions/feature-flags/reports/auth-control/settings + الصفحة الرئيسية (overview-cards, activity-feed, ai-insights, revenue-chart, system-health, command-palette, tenants-table)
- إصلاح shared UI primitives المستخدَمة فقط من SuperAdmin: `dialog.tsx`, `input.tsx`, `button.tsx` (outline/ghost variants)
- `npm run build` نجح + كل المسارات ظهرت + commit `44a528c` (34 ملف)

## مشاكل ظهرت من الاستخدام الفعلي بعد تفعيل الـ toggle — June 25, 2026 (commit `e86e806`)
1. **`subscriptions.json` (ar + en) كان فيه double-nesting خاطئ** (طبقة `"subscriptions": {...}` إضافية فوق كل المفاتيح) — `request.ts` يستخدم هذا الملف raw بدون دمج مع الجذر (`pos`/`orders`/`settings`/`users`/`superadmin`/`subscriptions` كلها raw، خلاف `expenses`/`customers`/`reports`/`shell`/`dashboard`/`common` التي تُدمَج مع الجذر) — أدّى لظهور مفاتيح الترجمة الحرفية بدل النص الفعلي بصفحة الاشتراكات. **تم التحقق أن `superadmin.json` لا يحمل نفس الخلل**
2. **فلاش غامق عند التنقل بين الصفحات** — السبب: `app/[locale]/superadmin/loading.tsx` (route-level Next.js loading boundary) كان hardcoded بخلفية غامقة فقط (`bg-[#141720]`) بلا `dark:` pairing — خارج نطاق تحويل §41 الأصلي (29 ملف) لأنه ملف منفصل لم يُغطَّ
3. **نص أبيض على خلفية فاتحة (white-on-white)** — مصدران فعليان:
   - `app/[locale]/superadmin/auth-control/page.tsx` — صفحة "Coming Soon" متروكة (stub قديم، لم يُستبدَل بأي مكوّن فعلي من `features/superadmin/auth-control/`) كانت permanently dark (`text-white` بلا variant فاتح)
   - `shared/ui/dropdown.tsx` — يُستخدَم فقط من `TenantActionsDropdown.tsx` (قائمة إجراءات جدول التينانتس بالسوبرأدمن) — كان permanently dark (`bg-[#1a1f2e]`, `text-white` بلا pairing) — تم التأكد عبر grep أنه غير مستخدَم بأي مكان آخر بالمشروع (آمن التعديل المباشر)
4. تم التحقق أن باقي الـ skeleton loaders (`animate-pulse` بصفحات/كومبوننتات السوبر أدمن الفعلية) كانت مصحَّحة أصلاً من تحويل §41 الأول — المشكلة محصورة بـ `loading.tsx` فقط

## الإصلاح
- `messages/{ar,en}/subscriptions.json` — أُزيلت الطبقة الإضافية، تسطيح كامل للبنية
- `app/[locale]/superadmin/loading.tsx` — `dark:` pairing لكل skeleton block (`bg-slate-200 dark:bg-[#141720]`)
- `app/[locale]/superadmin/auth-control/page.tsx` — `dark:` pairing (نفس النمط — الصفحة تبقى stub "Coming Soon"، لم يُبنَ المكوّن الفعلي، خارج النطاق المطلوب)
- `shared/ui/dropdown.tsx` — `dark:` pairing كامل (content bg/border، item text/hover، separator، label)
- `npx tsc --noEmit` نجح بدون أخطاء + تحقق JSON صحيح للملفين

## طلب إضافي لاحق — إزالة hardcode عربي من صفحة الإعدادات
المستخدم طلب صراحةً إزالة النصوص العربية المكتوبة مباشرة بصفحة `/superadmin/settings` واستخدام ملفات اللغة.
- أُضيف namespace جديد كامل `superadmin.settings.*` لكل من `messages/ar/superadmin.json` و `messages/en/superadmin.json` (tabs, profile, security, notifications, system, save/saved)
- أُعيد كتابة `SuperAdminSettingsPage.tsx` بالكامل لاستخدام `useTranslations('superadmin.settings')` بدل أي نص عربي مكتوب مباشرة — لا تغيير بالتصميم/الستايل، فقط استبدال النصوص

## نُشر فعليًا — commit `e86e806`
كل الإصلاحات أعلاه (1-4 + namespace الإعدادات) دُمجت بنفس الـ commit ونُشرت بطلب المستخدم ("ادفع").

## ملفات تم تعديلها (هذه الجلسة)
- `web/messages/ar/subscriptions.json`, `web/messages/en/subscriptions.json`
- `web/messages/ar/superadmin.json`, `web/messages/en/superadmin.json` (namespace `settings` جديد)
- `web/src/app/[locale]/superadmin/loading.tsx`
- `web/src/app/[locale]/superadmin/auth-control/page.tsx`
- `web/src/shared/ui/dropdown.tsx`
- `web/src/features/superadmin/settings/SuperAdminSettingsPage.tsx`

## متبقٍ / معروف
- `app/[locale]/superadmin/auth-control/page.tsx` لا يزال stub "Coming Soon" — لا تطبيق فعلي للمكوّنات الموجودة بالفعل (`UsersSection.tsx`, `SessionsSection.tsx`, `ResetPasswordDialog.tsx` بـ `features/superadmin/auth-control/`) — هذا مرتبط بفجوة Backend الموثّقة مسبقًا بـ§7 KNOWN GAPS ("Auth Control endpoints غير موجودة في backend بعد") وبـ Phase 10M
- `shared/ui/{avatar,card,select,tabs,tooltip}.tsx` لا تزال permanently-dark (غير مستخدَمة بأي مكان بالمشروع حاليًا — تم التحقق بـ grep) — لا حاجة فعلية للتعديل إلا إذا استُخدمت لاحقًا

---

# 42. Feature/Settings Audit — June 25, 2026

## السياق
التاسك التالي بالترتيب في TASKS.md (المُعرَّف أصلاً بـ§29 كـ "Feature/Settings Audit — بناء صفحة الإعدادات الكاملة"). تم تدقيق صفحة الإعدادات الفعلية للـ tenant dashboard (`SettingsPage.tsx`) وكل المكوّنات المرتبطة بها مباشرة (Custom Fields، POS Customer Picker) بحثًا عن: (1) بيانات يحسبها الـ backend ولا تُعرَض بالواجهة، (2) نص عربي hardcoded بمعزل عن ملفات اللغة (نفس فئة الباغ المُصلَحة بـ§41 للسوبرأدمن).

## النتائج والإصلاحات

### 1. ميزة فعلية غائبة عن الواجهة
`GET /tenant/usage` (`tenants.service.ts:50-69`) يحسب فعليًا `invoices_this_month` (عدد الفواتير هذا الشهر) عبر `countInvoicesThisMonth()` — لكن `SettingsPage.tsx` لم يكن يعرضه إطلاقًا بقسم "الاستخدام" (فقط `users`/`branches`). أُضيف كعنصر ثالث بنفس القسم (`grid-cols-3` بدل `grid-cols-2` على الشاشات الأوسع) + مفتاح ترجمة `invoicesThisMonth` (ar/en)

### 2. نص عربي hardcoded — `SettingsPage.tsx`
عنوان قسم "العملة" وقسم "حقول العميل المخصصة" + جملة الشرح أسفله كانت مكتوبة مباشرة بالعربي بمعزل تام عن باقي الصفحة (التي تستخدم `useTranslations('settings')` بالكامل). أُضيفت مفاتيح `currency`, `customFields`, `customFieldsHint` لـ `settings.json` (ar/en)

### 3. نص عربي hardcoded بالكامل — `CustomerPickerModal.tsx` (POS)
هذا المكوّن (نافذة بحث/تسجيل عميل أثناء البيع) لم يكن يستورد `next-intl` إطلاقًا — كل النصوص (عناوين، أزرار، رسائل حالة) عربي مباشر بالكود، يعني لن يتغيّر أبدًا عند تبديل اللغة للإنجليزية. أُضيف namespace جديد `pos.customerPicker.*` (ar/en) + أُعيد ربط المكوّن بالكامل بـ `useTranslations('pos.customerPicker')`

## اكتشاف جانبي — أُرسل كـ task منفصل (`task_f462d2ba`) ونُفِّذ فعليًا
نفس فئة الباغ (نص عربي بلا أي `useTranslations`) كانت موجودة بـ 6 ملفات أخرى خارج نطاق صفحة الإعدادات المباشر (81 سطر إجمالي): `AddCategoryModal.tsx`, `AddExpenseModal.tsx`, `CategoriesList.tsx`, `TemplatesList.tsx` (الأكبر — 37 سطر) بـ `dashboard/expenses/`, و `ReceiptModal.tsx` بـ POS، و `TenantStatusBadge.tsx` بالسوبرأدمن. أُرسل كـ background task مستقل، وأكمله المستخدم فعليًا بنفس الجلسة (5 من 6 ملفات احتاجت تعديل فعلي — `TenantStatusBadge.tsx` تبيّن أنه لم يكن يحوي نصًا عربيًا hardcoded فعليًا عند الفحص الثاني). أضاف namespace كامل `receipt.*` جديد لـ `pos.json` (invoiceNumber, printButton, taxLabel, currency, methodSplit) ومفاتيح مقابلة بـ `expenses.json`. دُمج مع باقي تعديلات هذا التاسك بنفس commit واحد ونُشر

## التحقق
- `node -e "JSON.parse(...)"` نجح لكل ملفات JSON المعدَّلة (`settings.json`, `pos.json`, `expenses.json` — ar/en)
- `npx tsc --noEmit` نجح بدون أخطاء على كامل المشروع

## ملفات تم تعديلها
- `web/messages/{ar,en}/settings.json`
- `web/messages/{ar,en}/pos.json`
- `web/messages/{ar,en}/expenses.json`
- `web/src/features/settings/pages/SettingsPage.tsx`
- `web/src/features/pos/components/CustomerPickerModal.tsx`
- `web/src/features/pos/components/ReceiptModal.tsx`
- `web/src/features/dashboard/expenses/components/{AddCategoryModal,AddExpenseModal,CategoriesList,TemplatesList}.tsx`

## نُشر فعليًا — commit `25b5d13`
طلب المستخدم الدفع بعد التحقق من نجاح build/typecheck — تم.

---

# 43. Misc Fixes — Mobile Menu Button + Background Shorthand + TenantStatusBadge i18n — June 25, 2026

## السياق
طلب المستخدم "ادفع + حدث ملفات المشروع". وُجدت 4 ملفات معدَّلة بدون commit (لم تكن من تعديلاتي المباشرة بهذه الجلسة — تعديلات تراكمت بالـ working directory). تم فحصها بالكامل (diff) قبل أي commit للتأكد أنها إصلاحات حقيقية ومتوافقة مع باقي الكود قبل الدفع.

## الإصلاحات
1. **`DashboardHeader.tsx`** — زر قائمة الموبايل (hamburger) كان يستخدم `className="lg:hidden"` بالتزامن مع `style={{ display: 'flex', ... }}` — أي override خارجي على الـ className (أو إعادة render) كان يخطر بفقد `display: flex` لأن الـ inline style لا يحتوي على breakpoint. أُصلح بدمج `display` بالكامل داخل className (`flex lg:hidden`) وإزالته من inline style
2. **`DashboardLayout.tsx` + `SuperAdminLayout.tsx`** — كانت تستخدم `background:` (shorthand) يحوي gradient + solid color سوية، بينما `backgroundAttachment: 'fixed'` بخاصية منفصلة — أي إعادة استخدام لاحقة لـ `background` shorthand كانت تصفّر `backgroundAttachment` بصمت (سلوك CSS shorthand reset قياسي). أُصلح بتفكيك الـ shorthand إلى `backgroundImage` (gradients فقط) + `backgroundColor` (اللون الصلب) منفصلين، فلا يتصادمان مع `backgroundAttachment`
3. **`TenantStatusBadge.tsx`** — نص عربي hardcoded (active/trial/suspended/cancelled) بمعزل عن أي `useTranslations` — أُصلح بنفس نمط باقي مكوّنات `tenants/` (`useTranslations('tenants')` + مفاتيح `status.*` الموجودة مسبقًا بـ `superadmin.json`). **ملاحظة**: هذا الملف كان قد فُحص سابقًا بـ§42 وبدا خاليًا من الـ hardcode عند الفحص الأول (grep لم يُطابق وقتها) — لكن تعديلًا تاليًا (من المستخدم أو نفس الجلسة) ألغى ذلك التشخيص بإضافة العربي المباشر، وتم اكتشافه وإصلاحه هنا

## التحقق
- `npx tsc --noEmit` نجح بدون أخطاء

## نُشر فعليًا — commit `38856b8`

## ملفات تم تعديلها
- `web/src/features/dashboard/components/DashboardHeader.tsx`
- `web/src/features/dashboard/components/DashboardLayout.tsx`
- `web/src/features/superadmin/components/SuperAdminLayout.tsx`
- `web/src/features/superadmin/tenants/components/TenantStatusBadge.tsx`

---

# 44. Sidebar Hamburger Disconnected (#29 بند 7) — تشخيص حقيقي وإصلاح + نشر — June 26, 2026

## السياق
المستخدم اشتكى: "سايد بار السوبر أدمن منفصل ولا يرتبط بالـ☰ (هامبرغر)". الفحص الأول الثابت للكود (مقارنة `SuperAdminSidebar`/`SuperAdminLayout` مع `DashboardSidebar`/`DashboardLayout` المطابق تمامًا) لم يُظهر أي خلل بنيوي — كلا المكوّنين يمرّران `open`/`onClose`/`onMenuClick` بنفس الطريقة الصحيحة.

## التشخيص الفعلي (عبر تفاعل مباشر مع المستخدم، بدون وصول للمتصفح من جهتي)
- إضافة Chrome في هذه الجلسة لم تتصل (فشل متكرر) — التشخيص تم بالكامل عبر وصف المستخدم + screenshots + تشغيل dev server محلي وفحص سجلّه
- المستخدم حدّد: عند تكبير DevTools (عرض ضيّق) الزر يعمل صحيح؛ على الشاشة الكاملة العادية الزر **يظهر لكن بلا أي تأثير**، والسايد بار أصلاً ظاهر دائمًا على اليمين بهذا العرض
- **السبب الجذري المؤكَّد**: `DashboardHeader.tsx` (مكوّن مشترك بين Tenant Dashboard و SuperAdmin) — زر الهامبرغر يستخدم `style={{ display: 'flex', ... }}` (inline) مع `className="lg:hidden"`. الـ inline style له أولوية مطلقة على أي كلاس CSS (بما فيها media queries) في كل المتصفحات — فـ `lg:hidden` لا يقدر يُخفي الزر أبدًا على الشاشات ≥1024px، فيبقى ظاهر بلا فائدة فعلية بينما السايد بار بهذا العرض أصلاً ثابت بمعزل عن أي state
- لوحظ أيضًا أثناء الفحص: تحذير React متكرر بسجل dev server (`background`/`backgroundAttachment` shorthand conflict) بنفس النمط بـ`DashboardLayout.tsx` و`SuperAdminLayout.tsx` — مرتبط بنفس آلية الخلفية المتدرّجة، تم إصلاحه بالتزامن

## الإصلاح
1. `DashboardHeader.tsx` — نُقل `display: 'flex'` من inline style إلى className (`className="flex lg:hidden"`)، فصار `lg:hidden` فعليًا يُخفي الزر على الديسكتوب كما يفترض (سايد بار دائم بدون حاجة لزر تبديل)
2. `DashboardLayout.tsx` + `SuperAdminLayout.tsx` — فصل خاصية `background` (shorthand) إلى `backgroundImage` (التدرّجات فقط) + `backgroundColor` (اللون الصلب الأخير)، مع إبقاء `backgroundAttachment: 'fixed'` منفصلة — يحل تحذير React بدون أي تغيير بصري

## التحقق
- `npx tsc --noEmit` نجح بدون أخطاء بعد كل تعديل
- اختبار حي فعلي من المستخدم على `localhost:3000` (بعد إعادة تشغيل dev server + حذف `.next` cache لإجبار rebuild نظيف): تأكَّد اختفاء الزر صحيح على الشاشة الكاملة لكلا الواجهتين (tenant + superadmin)
- الالتباس الأول ("نفس المشكلة بالداشبورد") كان سببه اختبار المستخدم على رابط production (`sefayv1-0-2.vercel.app`) القديم بدل `localhost` — تم توضيحه وتأكيد عدم وجود فرق فعلي بين الواجهتين

## النشر — Production
المشروع **لا يحتوي على git repo فعلي** بهذا المسار (`C:\Fp`) — لا commit/push عبر git ممكن من هذه الجلسة. تم النشر مباشرة عبر **Vercel CLI** (مربوط مسبقًا بـ`.vercel/repo.json` — project `sefayv1-0-2`، تسجيل دخول فعلي كـ`abduallazizaltyar-8744`):
```
npx vercel --prod --yes
```
نتيجة: بناء ناجح (`✓ Compiled successfully`) ونشر مكتمل، alias محدَّث فعليًا على `https://sefayv1-0-2.vercel.app` — deployment id `dpl_FvLvXUNawpoSmZpfkHLGRrsXEScv`

## ملفات تم تعديلها
- `web/src/features/dashboard/components/DashboardHeader.tsx`
- `web/src/features/dashboard/components/DashboardLayout.tsx`
- `web/src/features/superadmin/components/SuperAdminLayout.tsx`
- `TASKS.md` (تحديث بند "Sidebar Links Fix" إلى ✅)
- `STATUS.md` (هذا القسم + تحديث جدول §29 بند 7)

## ملاحظة مهمّة لأي جلسة قادمة
لا يوجد git repo في `C:\Fp` ولا فرع/remote مُهيّأ. أي "دفع" مستقبلي لكود لهذا المشروع يجب أن يكون عبر **Vercel CLI مباشرة** (`vercel --prod`) ما لم يُهيّأ git lاحقًا. إن احتاج المستخدم تتبّع نسخ (history/rollback)، يُنصح بتهيئة git repo حقيقي وربطه — هذا قرار يحتاج تأكيد المستخدم أولاً، وليس إجراء تلقائي.

## تصحيح لاحق — هذه الملاحظة كانت غير دقيقة (جلسة لاحقة، نفس اليوم)
`C:\Fp\web` **له فعليًا git repo حقيقي** مربوط بـ `https://github.com/abduallaziz/sefayv1.0.2.git` (نفس الريبو المستخدَم بكل الجلسات السابقة لهذا المشروع — راجع §41-43). الملاحظة أعلاه على الأرجح كُتبت من بيئة عمل مختلفة (worktree/clone منفصل لا يحتوي `.git` فعليًا) لا تمثّل الحالة الحقيقية لمجلد العمل المعتاد. **تم تأكيد التزامن**: نفس إصلاحات `DashboardHeader.tsx`/`DashboardLayout.tsx`/`SuperAdminLayout.tsx` المذكورة بهذا القسم (§44) كانت قد دُفعت أيضًا عبر git بنفس اليوم (commits `38856b8`/`348558a`) — أي push الـ Vercel CLI المباشر هنا لم يخلق انحرافًا فعليًا عن git، لأن نفس المحتوى موجود بكلا المسارين. **تنبيه للمستقبل**: لو تكرّر هذا الموقف (جلسة تظن "لا يوجد git")، يجب التحقق فعليًا بـ `git remote -v` قبل اللجوء لنشر مباشر عبر Vercel CLI يتجاوز git — لتجنّب انحراف حقيقي بين الكود المنشور وتاريخ git لاحقًا.

---

# 45. Dynamic Platform — Granular Activity (37 نشاط) — June 26, 2026 — **غير منشور (بانتظار migration)**

## السياق
المتبقي الوحيد من تاسك "Dynamic platform (business_type)" بالـ"الوضع الحالي": البنية التحتية كانت كاملة end-to-end لكن `BUSINESS_TYPE_CONFIG` نفس القائمة لـ6 فئات عريضة بلا تمييز فعلي. عند الفحص تبيّن أن نموذج Onboarding يجمع فعليًا نشاطًا دقيقًا واحدًا من **37 نشاطًا فرعيًا** (8 أقسام: مطاعم/تجزئة/أزياء/صحة/تجميل/خدمات/إلكترونيات/منزل — `OnboardingWizard.tsx ACTIVITY_SECTIONS`)، لكن `auth.service.ts` يحوّله فورًا عبر `ACTIVITY_SECTION_TO_BUSINESS_TYPE` إلى واحدة من 6 فئات فقط قبل الحفظ — التفصيل الدقيق (مثلاً "مغسلة سيارات" مقابل "صيدلية") يُفقد كاملاً عند التسجيل.

طلب المستخدم التمييز على مستوى الـ37 نشاط (الموصى)، لا 6 فئات.

## ما تم بناؤه

### DB
`migration 015_tenants_activity.sql` — عمود `tenants.activity VARCHAR(40)` إضافي، nullable، **لم يُطبَّق على production بعد** (المستخدم طلب الانتظار). يبقى `business_type` كما هو (6 فئات) لتوافق رجعي مع ميزات تعتمد عليه فعليًا (حقول السيارة بـCustomFieldsManager/CustomersTable — `VEHICLE_BUSINESS_TYPES = ['workshop','services']`، من Phase 10C).

### Backend
- `jwt-payload.type.ts` — `activity: string | null` جديد
- `auth.service.ts` — `getTenantBusinessType()` يرجع الآن `{business_type, activity}` معًا (نفس استعلام واحد، عمودين)؛ `register()` يكتب `activity: dto.activity` (الخام، بدون تحويل) بجانب `business_type` المحوَّل كالسابق؛ `login()`/`refresh()`/`me()` كلها تُمرّر `activity` بالـ JWT/الاستجابة
- `tenants.repository.ts` — `activity` مضاف لـ`select` بـ`findById`/`updateProfile` (قراءة فقط حاليًا، لا تعديل من الواجهة)

### Frontend
- `business-type.config.ts` — أُعيد بناؤه بالكامل: `ActivityKey` (union 37 قيمة) بدل `BusinessTypeKey` (6 قيم) كمفتاح أساسي للسايدبار. التسميات تُقرأ من `onboarding.activity.*` الموجودة مسبقًا (ar/en لكل الـ37) — لا تكرار ترجمات
- `useBusinessType()` — يقرأ `user.activity` أولًا، وإن كان `null` (تينانتات قديمة قبل هذا التغيير) يستمدّ نشاطًا تمثيليًا من `business_type` القديم عبر `BUSINESS_TYPE_TO_ACTIVITY` — لا انكسار للتينانتات الحالية
- `auth.store.ts`/`auth.api.ts`/`auth.provider.tsx`/`use-auth.ts`/`LoginPage.tsx` — `activity` مُمرَّر بكل نفس النقاط التي يُمرَّر بها `business_type` (نفس نمط §28 بالضبط)

## محاولة تمييز فعلي بالسايدبار — رُفضت من المستخدم فورًا
أول تنفيذ أخفى `pos` من السايدبار لـ11 نشاطًا خدميًا بحتًا بلا مخزون منتجات (خياطة، طبي، عيادات، حلاقة، صالونات نسائية، سبا، مغاسل سيارات، مغاسل ملابس، صيانة جوالات، ورش سيارات، خدمات منزلية) — استنادًا لملاحظة موجودة فعليًا بـ§28 (نفسها، June 23) لم تُنفَّذ وقتها: *"services/workshop: لا pos في sidebar (لا حاجة لـ POS في هذه الأنواع)"*.

المستخدم رفض هذا فورًا وبشدة: **"نقطة البيع يجب أن تكون في الجميع دون استثناء، أهم ميزة بشراء النظام بالكامل، تُحذف؟"** — تصحيح صريح يبطل قرار §28 القديم. أُزيل تمييز POS بالكامل؛ كل الـ37 نشاطًا يحصلون على السايدبار الكامل (10 عناصر) بلا أي استثناء.

## النتيجة الفعلية الحالية — **التاسك لم ينتهِ**
البنية التحتية الآن تتعقّب وتحفظ النشاط الدقيق (37 قيمة) فعليًا من نهاية لنهاية — جاهزة لأي تمييز مستقبلي حقيقي (تقارير/حقول مخصصة افتراضية/قوالب per-activity) **لكن لا يوجد حاليًا أي تمييز فعلي بالسايدبار نفسه** — كل الأنشطة تحصل على نفس القائمة الكاملة، بطلب صريح من المستخدم. هذا مطابق تمامًا لما كانت الحالة عليه قبل هذه الجلسة (سايدبار واحد لكل الأنواع) — الفرق الوحيد: التفصيل الدقيق (37 بدل 6) يُحفظ الآن فعليًا بدل أن يُفقَد عند التسجيل.

## سؤال متابعة من المستخدم — هل التمييز يُطبَّق على عناصر السايدبار الحالية (مثل `items`)؟
سألت إن كان يريد تمييزًا على العناصر الموجودة فعليًا الآن (مثال: هل تحتاج مغسلة سيارات عنصر "المنتجات" items كمحل بقالة؟). **جواب المستخدم: "لا، انتظر ميزات جديدة فعلية (مجلس/طاولات/إلخ)"** — أي لا تمييز إطلاقًا على العناصر الحالية، فقط على ميزات مستقبلية لم تُبنَ بعد (طاولات Phase 10F وأمثالها). أكّد المستخدم صريحًا بعدها: **"حسنًا، يعني هذه الميزة لم تنتهِ"** — توصيف دقيق ومتّفق عليه، لا اعتراض على ذلك. هذا التاسك يبقى 🔶 جزئي/غير مكتمل بصدق حتى تُبنى ميزة فعلية تحتاج فعليًا لهذا التمييز.

## التحقق
- `npx tsc --noEmit` نجح بدون أخطاء (api + web)
- `npm run build` نجح لكل من api وweb

## نُشر فعليًا — June 26, 2026
1. ✅ تشغيل `npm run migrate` على production — تم (المستخدم وافق: "migration اعمل")
2. ✅ push الكود — تم بعد المigration مباشرة، بالترتيب الصحيح: api commit `178f5b2`، web commit `ef51be2`
3. تأكيد: لم ينكسر أي شيء لأن العمود كان موجودًا فعليًا قبل push الكود الذي يعتمد عليه

## ملفات تم تعديلها (غير مدفوعة)
- `api/src/database/migrations/015_tenants_activity.sql` (جديد، غير مُطبَّق)
- `api/src/shared/types/jwt-payload.type.ts`
- `api/src/modules/auth/auth.service.ts`
- `api/src/modules/tenants/repositories/tenants.repository.ts`
- `web/src/shared/config/business-type.config.ts`
- `web/src/shared/hooks/useBusinessType.ts`
- `web/src/core/auth/stores/auth.store.ts`
- `web/src/features/auth/api/auth.api.ts`
- `web/src/features/auth/hooks/use-auth.ts`
- `web/src/features/auth/pages/LoginPage.tsx`
- `web/src/core/auth/auth.provider.tsx`

---

# 46. Production / Manufacturing Module — مخطَّط بالكامل، مؤجَّل بقرار المستخدم — June 26, 2026

## السياق
بعد سؤال المستخدم عن "دورة الإنتاج/التصنيع + تكلفة المواد"، تبيّن أن الهدف الفعلي هو استهداف **عملاء جدد** للنظام: مصانع/شركات تصنيعية حقيقية — لا مجرد توسيع وصفات المطاعم. المستخدم رفض صريحًا أبسط نهج ("وصفة = مكوّنات") لصالح نطاق حقيقي يناسب مصانع فعلية: أوامر تصنيع متعددة المراحل (work orders) + مخزون قيد التصنيع (WIP) + Bill of Materials بتكلفة متراكمة.

## ما تم
- بحث كامل عبر Explore agents: بنية `items`/`pos-engine` الحالية (اكتُشف `cost_price` موجود بالـDB لكنه معطّل/غير مُستخدَم بأي DTO)، نمط الـ"pure engines" (`ApprovalEngine` كمرجع دقيق لمنطق انتقال الحالة)، اتفاقيات migrations، نمط أحدث سابقة حقيقية لإضافة sub-feature جديدة بنظافة (`customer-field-definitions.*` من Phase 10C)، القائمة الكاملة لـ37 نشاط onboarding الحالية.
- تصميم كامل عبر Plan agent: مخطط DB (migration 016 جديدة)، production-engine نقي، وحدة backend كاملة، صلاحيات جديدة، واجهة frontend، خطة تحقق end-to-end.
- مراجعة Phase 3 (قراءة مباشرة): تأكدت من `ScopedRepository`، الاستعلامات الفعلية بـ`ItemsRepository`، موقع namespace `sidebar` بالـi18n (جذر `messages/ar.json`، ليس `shell.json`)، الاسم الفعلي لمصفوفة `ALL_NAV_ITEMS` بـ`DashboardSidebar.tsx` — كل افتراضات الخطة طابقت الكود الفعلي.
- خطة نهائية كاملة كُتبت واعتُمدت من المستخدم (`ExitPlanMode`).

## القرار النهائي — مؤجَّل عمدًا
**فور اعتماد الخطة، طلب المستخدم: "لا تبدؤ بالبناء"**، ثم أكّد: **"سنحفظ هذا، مهم مستقبليًا، بعد انتهاء المشروع بالكامل نبدء فيها"**.

يعني: لا تنفيذ إطلاقًا الآن (لا migration، لا كود، لا أي تعديل) — هذا تاسك مستقبلي حقيقي مُجدوَل بعد اكتمال كل فيزات المشروع الحالية (Phase 10/11/12)، وثُبت كـ**Phase 13** بـ`TASKS.md`.

## أين الخطة المحفوظة
`C:\Users\GAMER2026\.claude\plans\greedy-discovering-patterson.md` — خطة تنفيذ كاملة ومفصّلة جاهزة فعليًا (لا حاجة لإعادة بحث/تصميم عند البدء لاحقًا، فقط تنفيذ مباشر حسب الملف). تتضمن: أسماء أعمدة جداول دقيقة، مسارات ملفات كاملة، تسلسل API كامل، 5 قرارات تصميم صريحة (مُسجَّلة بالخطة كـ"design decisions made — transparent، لا تتطلب تأكيد مستخدم فردي").

## ملاحظة مهمة لأي جلسة قادمة
لا تبدأ هذا التاسك إلا بطلب صريح من المستخدم بعد تأكيد أن باقي المشروع (Phase 10 بكل فروعه + Phase 11 Mobile POS + أي بقية من Phase 12) مكتمل فعليًا — أو بطلب صريح يتجاوز هذا الترتيب. لا تفترض الجاهزية — اسأل أولًا.

---

# 47. توحيد كل أنظمة التاريخ على DateRangePicker — منشور — June 26, 2026 (commit `91aeb78`)

## السياق
المستخدم لاحظ (بصورة لزر اليوم/هذا الأسبوع/هذا الشهر بالداشبورد) أن نظام التواريخ بالمشروع مشتت — كل صفحة تبني تحكّمها الخاص بالفترة بطريقة مختلفة، مع وجود مكوّن جاهز ومصمَّم بالفعل (`web/src/shared/ui/date-range-picker/DateRangePicker.tsx` — تقويم كامل + presets + RTL + dark mode، صفر تبعيات) لكنه يُستخدم بمكان واحد فقط (`OrderFilters.tsx`).

## الجرد (عبر Explore agent + قراءة مباشرة)
4 مواقع أخرى كل واحد يطبّق فكرة الفترة بطريقة مختلفة:
- `DashboardOverview.tsx` — أزرار اليوم/الأسبوع/الشهر
- `ReportsPage.tsx` — أزرار مطابقة لكن تطبيق منفصل
- `superadmin/components/revenue-chart.tsx` — أزرار 7D/1M/3M/1Y
- `superadmin/reports/ReportsAuditPage.tsx` — **بلا أي تحكم بالواجهة أصلاً**، فترة ثابتة بالكود (12 شهر)

## اكتشاف حقيقي أثناء التنفيذ
أزرار 7D/1M/3M/1Y بـ`revenue-chart.tsx` كانت **شكلية بالكامل** — `activePeriod` state محلي لا يُستخدم أبدًا لإعادة جلب البيانات (الـ`data` تأتي prop ثابت من `useRevenue()` بدون أي معامل). يعني الزر لم يكن يفعل أي شيء فعليًا منذ بنائه.

## التحقق قبل التنفيذ
فُحص الباك إند بالكامل (`ReportQueryDto`, `AnalyticsQueryDto`, `reports.service.ts`, `platform-analytics.repository.ts`) — **كل endpoint مستهدَف كان يدعم `from`/`to` فعليًا مسبقًا** (الفرونت إند فقط لم يكن يرسلهما). لا حاجة لأي تعديل بالباك إند — التوحيد كان frontend-only بالكامل.

## ما تم
- `DashboardOverview.tsx` + `ReportsPage.tsx`: الأزرار → `DateRangePicker`، كل الكويريز (`revenue/payments/expenses/topItems` أو `revenue/shifts/expenses`) تستخدم `{period:'custom', from, to}`
- `revenue-chart.tsx`: الزر الشكلي → `DateRangePicker` حقيقي عبر props (`range`, `onRangeChange`) من `superadmin/page.tsx`، مربوط فعليًا بـ`getMRRHistory(from,to)`
- `ReportsAuditPage.tsx`: أُضيف `DateRangePicker` بالهيدر يتحكم بـ`mrrHistory`/`churn`/`growth` معًا (لم يكن لها أي تحكم بالواجهة من الأساس)
- `superadmin.api.ts` + `use-tenants.ts`: `getMRRHistory`/`getChurnRate`/`getGrowthRate` صارت تقبل `from`/`to` فعليًا (كانت تتجاهلهما بالفرونت إند فقط)

## التحقق
`tsc --noEmit` نظيف (api + web) + `npm run build` كامل للـweb نجح بدون أخطاء.

## ملاحظة
`revenueByPlanQuery`/`statsQuery` بـ`ReportsAuditPage.tsx` لم تُلمَس عمدًا — بيانات لحظية/تراكمية (snapshot حالي)، ليست تقارير محصورة بفترة، فلا داعٍ لربطها بـ`DateRangePicker`.

---

# 48. تصليبات على نظام التاريخ — حقل تاريخ مفرد + إصلاح القص (clipping) + ترتيب الطبقات — June 26, 2026

بعد §47 (توحيد كل أماكن التاريخ على `DateRangePicker`)، المستخدم رفع 3 مشاكل حقيقية فعلية بالاستخدام، كل واحدة بكوميت منفصل:

## 1) `SingleDatePicker` — حقل تاريخ مفرد بدون قائمة جانبية (commit `5295f9d`)
حقول العميل المخصّصة من نوع "date" (مثل "تاريخ الزيارة" بنشاط الورشة) كانت تستخدم `<input type="date">` أصلي — المتصفح هو من يرسم placeholder/value بلغته الخاصة، فيظهر مكسورًا بالعربي (نص معكوس "ةنس/رهش/موي") وسليمًا بالإنجليزي فقط. بُني مكوّن جديد `web/src/shared/ui/date-range-picker/SingleDatePicker.tsx` — نفس منطق رسم `DateRangePicker` (React + `Intl.DateTimeFormat`، بدون ودجت متصفح أصلي) لكن لتاريخ واحد فقط بلا presets. استُبدل في `CustomerFormModal.tsx` (الداشبورد) و`CustomerPickerModal.tsx` (الكاشير POS). أُضيف مفتاح i18n منفصل `datePicker.placeholderSingle` (كان يستعير نص "اختر فترة زمنية" الخاص بالنطاق، غير مناسب لتاريخ مفرد).

## 2) قص اللوحة (clipping) — RTL + overflow الحاوية الأب (commit `47ed556`)
لوحة التقويم كانت `position:absolute` داخل شجرة DOM الزر نفسه، فسبّب مشكلتين حقيقيتين:
- **بالعربي فقط**: اللوحة العريضة (presets+تقويم ≈430px) تفيض خارج حافة الشاشة اليسرى بلا حماية، فتُقصّ أيام التقويم
- **بكل اللغتين**: داخل حاوية قابلة للتمرير (مثل `CustomerFormModal`)، تُقصّ اللوحة بصريًا بسبب `overflow-y-auto` الحاوية الأب — مشكلة تخطيط بحتة، لا علاقة لها باللغة

**الحل**: `useFloatingPosition.ts` جديد يحسب موضع بكسل ثابت (`position:fixed`) من `getBoundingClientRect()` الزر الفعلي (محمي من الفيضان خارج حدود الشاشة + ينقلب للأعلى لو لا تكفي المساحة بالأسفل)، وعرض اللوحة عبر `createPortal` إلى `document.body` بدل كونها ابنة DOM للزر — يتجاوز RTL وoverflow الأب نهائيًا.

## 3) القص تحت الهيدر الثابت — ترتيب الطبقات (commit `fa7b106`)
بعد حل #2، ظهرت مشكلة جديدة: `DashboardHeader.tsx` يستخدم `zIndex: 300` (sticky)، واللوحة كانت تستخدم `z-50` فقط من Tailwind (=50) — فالهيدر يرسم **فوق** اللوحة عند فتحها قرب أعلى الصفحة، فتُقصّ حافتها العلوية (صف "من" + أسهم التنقل) ويصبح غير مقروء. ظهرت بكلا اللغتين لأنها مشكلة z-index بحتة، لا لغة. الحل: رفع z-index اللوحة لـ`9999` (inline style) بكلا الملفين.

## التحقق
`tsc --noEmit` و`npm run build` نظيفان بعد كل كوميت من الثلاثة.

---

# 49. RAILWAY BUILD FAILURE — `nest: Permission denied` — الجذر والحل النهائي — يونيو 2026

## المشكلة
كل deploy على Railway فشل بـ `sh: 1: nest: Permission denied` (exit 127)، عبر 6 محاولات بناء و4 محاولات إصلاح سابقة فاشلة (chmod على `.bin` مباشرة، استدعاء nest عبر `node` مباشرة، نقل chmod لمرحلة البناء، تشخيصات مباشرة من داخل بيئة Railway الفعلية عبر PR تشخيصي).

## السبب الجذري المؤكَّد
Nixpacks يضبط `NODE_ENV=production` تلقائيًا أثناء مرحلة `install`. هذا يجعل `npm ci` **يتجاهل devDependencies بصمت** (بما فيها `@nestjs/cli`) — بغض النظر عن أي flag صريح آخر. النتيجة: `node_modules/.bin/nest` لم يُنشأ إطلاقًا — لم تكن المشكلة متعلقة بصلاحيات الملفات (permissions) كما بدا من رسالة الخطأ المضلِّلة.

## الحل
`nixpacks.toml`: تغيير أمر التثبيت من `npm ci` إلى `npm ci --include=dev`. تم التحقق محليًا (إعادة إنتاج الفشل عبر `NODE_ENV=production npm ci`، ثم التأكد أن `--include=dev` يستعيد الملف الثنائي وأن `npm run build` ينجح) وعلى production فعليًا بعد النشر (PR #16، commit `8a576b7`).

## درس مهم
بناءات "ناجحة" سابقة كانت تعتمد بصمت على طبقة Docker مخزَّنة (cached layer) سابقة لهذا السلوك — التخزين المؤقت أخفى الخلل الحقيقي حتى كشفه إعادة بناء نظيفة كاملة.

## التنظيف
كل التشخيصات المؤقتة المضافة أثناء التحقيق (PR #15) أُزيلت بالكامل بعد تأكيد الحل النهائي (PR #16) — بقي فقط `npm ci --include=dev` في `nixpacks.toml`.

---

# 50. INVENTORY & PURCHASING CORE — البناء الكامل (Backend + Frontend) — يونيو 2026

## السياق
أكبر امتداد للنظام منذ Phase 10C — وحدة مخزون ومشتريات كاملة، مبنية ومنشورة بالكامل على `apiv1.0.2`/`sefayv1.0.2`، لم تكن موثَّقة سابقًا بهاتين الوثيقتين (كانت لا تزال تصف 10D/10E كـ"لم يبدأ" بـTASKS.md حتى هذا التحديث).

## DB — 17 migration جديدة (016–032)
- 016: مخازن، مواقع، موردين، دفعات (batches)، نقاط إعادة الطلب (schema)
- 017: دفتر حركات المخزون (stock_movements)، مستويات المخزون (stock_levels)، طبقات التكلفة (cost_layers)، الحجوزات (reservations)
- 018: مشتريات (suppliers/purchase_orders/goods_receipts)، تسويات، تحويلات، جرد، outbox
- 019: دوال RPC ذرّية لعمليات المخزون
- 020: دور RBAC جديد `inventory_clerk` + صلاحياته
- 021: دوال RPC للتقارير
- 022: دالة claim للـ outbox
- 023: ترحيل `item_variants.stock_quantity` القديم (تجميد) إلى مصدر الحقيقة الجديد
- 024–028: RPC تحليلات، مستويات مخزون مُغنّاة (enriched)، دفتر حركات بالرصيد الجاري، إحصائيات ملف المورد، ملخص تقارير
- 029: إصلاح `42501 permission denied` على جداول المخزون/المشتريات (نفس فئة باغ §39 — صلاحيات service_role لم تُمنح تلقائيًا لجداول جديدة)
- 030: مواقع — وصف + بحث + ترقيم صفحات
- 031: إصلاح باغ حقيقي بالتحويلات (Transfer Receive) — حذف كتابة ميتة لعمود `quantity_received` غير موجود
- 032: عمليات المخزون مدركة للموقع (location-aware) — `location_id` مدمج بكل RPCs

## Backend (NestJS)
- وحدة Inventory كاملة: مخازن، مخزون، حجوزات، تسويات (مع workflow اعتماد عبر `ApprovalEngine`)، تحويلات، جرد
- وحدة Purchasing كاملة: موردين، أوامر شراء، استلام بضاعة
- Outbox relay worker (BullMQ) لتوصيل أحداث الدومين
- وحدة Analytics (ملخص لوحة تحكم) + endpoints مستويات مخزون/حركات مُغنّاة بالرصيد الجاري
- وحدة Inventory Reports (RPCs مجمَّعة بالحالة + endpoint نظرة عامة)
- ميزة جديدة كاملة (Locations) — CRUD + وصف + بحث + ترقيم صفحات + ترتيب + فلتر نشط + audit logging — لم تكن مخطَّطة أصلاً، اتسعت من إضافة صغيرة لربط end-to-end كامل عبر التحويلات/التسويات/استلام البضاعة/أوامر الشراء/الجرد

## Frontend (sefayv1.0.2)
- تكامل كامل Inventory + Purchasing بالسايدبار (قسم قابل للطي)
- لوحة تحكم المخزون، المخازن، مستويات المخزون (أُعيد بناؤها)، دفتر الحركات (صفحة جديدة)
- تصور workflow اعتماد التسويات
- أوامر الشراء (workflow + progress)، استلام البضاعة (تفاصيل + استلام جزئي)
- التحويلات (timeline/progress)، الجرد (progress/variance)
- تقارير المخزون (frontend + backend)
- صفحة المواقع (Locations) + نافذة CRUD + بحث/ترقيم + i18n عربي/إنجليزي

## تدقيق هندسي شامل — كل النتائج مُصلَحة
مراجعة سلامة المعاملات (transaction safety)، صحة RPCs (STABLE/VOLATILE، حقن SQL، تحقق المعاملات)، أمان (تفويض، عزل التينانت، حقن)، تحقق DTO، تفويض/صلاحيات، اتساق API، أداء — كل النتائج المكتشَفة أُصلحت، تمت جلسة تنظيف نهائية لكل من backend وfrontend.

## الحالة النهائية
هذا يحلّ بالكامل بنود 10E (الموردين والمشتريات) وأغلب بنود 10D (المخزون المتقدم) بـTASKS.md — الباقي حقيقي ولم يُبنَ بعد: باركود/ملصقات، تتبّع انتهاء صلاحية الدفعات + تنبيهاتها، تقرير COGS مُجمَّع كـ endpoint مكشوف، وصفات/BOM للمطاعم (لا تخلط مع Phase 13 الأوسع نطاقًا للتصنيع الصناعي).

**متبقٍ غير مكتمل (موثَّق صراحة، ليس فجوة مخفية)**: تلميع UX النهائي بالفرونت إند (إظهار/إخفاء أعمدة، إجراءات جماعية، اختصارات لوحة المفاتيح، رسوم بيانية، toast notifications، تمريرة accessibility) — لم يبدأ بعد.

---

# 51. تدقيق نهائي شامل للباك إند — إغلاق ملف التوثيق — يونيو 29, 2026

## السياق
بعد إغلاق ملف توثيق STATUS.md/TASKS.md (§49/§50)، طُلب تدقيق هندسي نهائي شامل: مطابقة `main` مع PRs المدموجة، تاريخ الكوميتات، الـ migrations، الموديولات، الـ repositories/services/controllers/DTOs، RPC functions، الصلاحيات، الـ seeds، البنية التحتية — قبل بدء أي مرحلة تطوير جديدة.

## النتائج
- **الفروع/الدمج**: فرعان فقط (`main` و`claude/verify-addition-8ual9f`)، الفرق بينهما = صفر. كل الـ 17 PR مدموجة، لا فروع مهجورة، لا عمل ضائع.
- **Migrations**: 001–032 متسلسلة بلا فجوات أو تضارب. إعادة تعريف بعض الدوال (`CREATE OR REPLACE`) عبر migrations لاحقة (032 location-aware، 031 إصلاح كتابة ميتة) — تطور متوقع، ليس تضاربًا.
- **RPC ↔ الكود ↔ المخطط**: كل استدعاء `.rpc()` في Inventory/Purchasing يطابق دالة معرَّفة فعليًا. لا استدعاءات معلَّقة.
- **الكود الميت**: لا يوجد، باستثناء عمود `item_variants.stock_quantity` المُجمَّد عمدًا (trigger يمنع الكتابة) — موثَّق ومقصود.
- **ثغرة حقيقية اكتُشفت ومُصلحت**: دور `inventory_clerk` كان موجودًا بالكامل على مستوى DB (migration 020) والصلاحيات (`permissions.seed.ts`) لكنه **لم يكن قابلًا للتعيين فعليًا** عبر Users API — `UserRole` enum بمستوى التطبيق (`src/shared/types/enums.ts`) لم يتضمنه، فكان `@IsEnum(UserRole)` يرفضه. تم الإصلاح:
  - إضافة `INVENTORY_CLERK = 'inventory_clerk'` إلى `UserRole` (apiv1.0.2)
  - تحديث قائمة الأدوار بمحدد إنشاء المستخدم `CreateUserDialog.tsx` (sefayv1.0.2)
  - تحديث نوع `TenantUser['role']` ومحدد الأدوار بـ`UsersSection.tsx` (لوحة السوبر أدمن، sefayv1.0.2)
  - (لوحة التنقل الجانبي `DashboardSidebar.tsx` كانت تتضمن `inventory_clerk` بالفعل ضمن `INVENTORY_ROLES` — لا تغيير مطلوب هناك)
- **فجوات توثيق فقط (لا أخطاء كود)**: `SecurityModule` (`core/security/`) و`OutboxModule` (`core/outbox/`) كانا موجودين بالكود وغير مذكورين بجدول الموديولات الفعّالة بـ§3 — أُضيفا الآن.

## التحقق
- `npx tsc --noEmit` و`npm run build` نظيفان على apiv1.0.2 بعد إضافة `INVENTORY_CLERK`.
- `npx tsc --noEmit` نظيف على sefayv1.0.2 بعد تحديثات الفرونت إند الثلاثة.

## الحالة النهائية
الباك إند متزامن بالكامل بين `main`، الـ PRs المدموجة، الـ migrations، والتوثيق. الثغرة الوحيدة الحقيقية المكتشفة (`inventory_clerk` غير قابل للتعيين) أُصلحت بالكامل end-to-end. لا عمل متبقٍ من جلسات سابقة غير مدموج أو منسي. جاهز لبدء مرحلة التطوير التالية.

---

# 52. تغنية (enrichment) قوائم المشتريات/المخزون + توحيد تنسيق الجداول — يونيو 29, 2026

## السياق
استمرارًا للتدقيق الشامل على الفرونت إند (Phase 2 UX)، تم تحديد أن قوائم أوامر الشراء، استلام البضاعة، التحويلات، والجرد تفتقد بيانات مجمَّعة مهمة (عدد العناصر، قيمة الطلب، نسبة الإنجاز، اسم المورد، عدد التفاوتات) — كانت تُحسب جزئيًا بالفرونت إند أو غير موجودة أصلًا، بنفس النمط الذي حلّته `fn_inventory_stock_levels_enriched` سابقًا لمستويات المخزون.

## التنفيذ
- **migration 034 جديدة** (`034_purchasing_ops_list_enriched.sql`) — 4 دوال SQL جديدة (`STABLE`، بدون تأثير على دوال RPC الذرّية الموجودة):
  - `fn_purchase_orders_list_enriched` — عدد العناصر، كمية مطلوبة/مستلمة، القيمة الإجمالية (`SUM(quantity_ordered * unit_cost)`)، نسبة الإنجاز، اسم المورد
  - `fn_goods_receipts_list_enriched` — اسم المورد (عبر أمر الشراء)، رقم أمر الشراء، عدد العناصر
  - `fn_stock_transfers_list_enriched` — عدد العناصر، تواريخ الإرسال/الاستلام
  - `fn_stock_counts_list_enriched` — عدد العناصر، عدد المعدود، عدد التفاوتات، صافي التفاوت بالكمية
  - **لم تُحذف أو تُستبدل** الدوال التحليلية الموجودة من migration 028 (`fn_purchase_orders_summary`, إلخ) — تلك دوال ملخص على مستوى التينانت لتقارير لوحة التحكم (صف واحد لكل حالة)، مختلفة جوهريًا عن الدوال الجديدة التي تعيد صفًا واحدًا لكل سجل (مطلوبة لجداول القوائم) — تم التحقق بالقراءة المباشرة لتجنّب الازدواجية أو حذف شيء مستخدَم فعليًا.
- **Repositories**: دالة `findAll()` فقط (لا `findById()`) في `purchase-orders.repository.ts`، `goods-receipts.repository.ts`، `transfers.repository.ts`، `counts.repository.ts` أصبحت تستدعي الـ RPC الجديد مباشرة بدل الـ `.select()` بجوينات بسيطة.
- **Services**: تبسيط `findAll()` في الموديولات الأربعة لتمرير البيانات المسطّحة (flat shape) مباشرة دون أي `.map()` لاستخراج أسماء متداخلة — `findById()` بقيت كما هي بدون تغيير في كل الأربعة.

## الفرونت إند (sefayv1.0.2)
- إضافة الحقول الجديدة لأنواع TypeScript (`PurchaseOrder`, `GoodsReceipt`, `Transfer`, `StockCount`)
- عرض الحقول الجديدة بجداول `PurchaseOrdersTable`، `GoodsReceiptsTable`، `TransfersTable`، `StockCountsTable` (بطاقات الموبايل + الجدول الديسكتوب)
- مفاتيح i18n جديدة بـ`purchasing.json` و`inventory.json` (عربي/إنجليزي)
- **توحيد تنسيق "صفوف متبادلة الألوان" (zebra striping)** عبر **كل** جداول المخزون/المشتريات (لا فقط الجداول التي حصلت على بيانات جديدة)، تطبيقًا لتعليمة "التطبيق المتسق للتحسين عبر كل الصفحات": أوامر الشراء، استلام البضاعة، التحويلات، الجرد، التسويات، المخازن، المواقع، الموردين، دفتر الحركات، المنتجات (Items).

## التحقق
- `npx tsc --noEmit` و`nest build` نظيفان على apiv1.0.2
- `npx tsc --noEmit` نظيف على sefayv1.0.2؛ `eslint` بلا مشاكل جديدة (المشاكل الموجودة بـItemsTable.tsx قديمة وغير متعلقة بهذا التغيير)

## الحالة النهائية
- PR مدموج على `apiv1.0.2` (#21) و`sefayv1.0.2` (#11)، كلاهما على `main`.
- ⚠️ **متبقٍ صراحةً**: migration 034 لم تُطبَّق فعليًا على قاعدة بيانات الإنتاج/staging بعد — الكود جاهز لكن endpoints لن تُرجع البيانات المُغنّاة حتى تُطبَّق الـ migration.

---

# 53. ⏸️ Phase مستقبلية مؤجَّلة — Smart Data Import Center (AI-assisted Import Platform) — يونيو 29, 2026

## الحالة
**لم يبدأ التنفيذ. هذه وثيقة تخطيط (roadmap) فقط — لا كود، لا migrations، لا موديول حتى الآن.** هذا القسم يُسجّل التصميم المتفَق عليه قبل البدء، حتى لا يُفقَد القرار الهندسي إذا تأخر التنفيذ لعدة أشهر.

## ⚠️ ليست جزءًا من مرحلة المخزون الحالية
هذه ميزة **مستقلة تمامًا** عن Inventory Phase 2/3 الجارية حاليًا (راجع §52 وما قبله). **لن يبدأ تنفيذها إلا بعد اكتمال واستقرار موديولات ERP الأساسية** (المخزون، المشتريات، نقاط البيع، العملاء، الفواتير، إلخ). ذُكرت هنا فقط لتثبيت التصميم المتفَق عليه بالذاكرة الهندسية للمشروع قبل أن يُنسى.

## الهدف
مركز استيراد بيانات موحَّد وذكي (Smart Data Import Center) يُستخدم لاستيراد أي كيان (Products، Warehouses، Locations، Customers، Suppliers، إلخ) من ملفات خارجية (Excel/CSV) بدل بناء شاشة استيراد مخصصة لكل كيان.

## المبدأ المعماري الأساسي
**Heuristics-first**: النظام يعمل بالكامل بدون أي اتصال بالذكاء الاصطناعي (rules + regex + قواميس مرادفات + محرك تحقق) — هذا هو الطريق الأساسي ويجب أن يعمل دائمًا offline. **طبقة الذكاء الاصطناعي اختيارية تمامًا** فوق هذا الأساس، تُستخدم لتحسين دقة المطابقة (column mapping)، مطابقة الكيانات (entity matching)، وتنظيف البيانات — وليست شرطًا لعمل الاستيراد الأساسي. هذا يضمن أن الميزة لا تعتمد على توفر/تكلفة/زمن استجابة مزوّد AI خارجي.

## البنية المعمارية المتفَق عليها
- **موديول مستقل قائم بذاته**: `modules/imports` (Import Center) — لا يُدمَج منطقه داخل موديولات الكيانات نفسها (Products، Warehouses...).
- **إطار عمل مشترك (shared framework)** يُستخدم من كل الكيانات بدل تكرار منطق الاستيراد لكل واحد منها على حدة — كيان جديد يحتاج فقط تعريف schema/mapping خاص به، لا بناء pipeline من الصفر.
- **Pipeline الاستيراد** (تسلسل مراحل موحَّد لكل الكيانات):
  1. **Upload** — رفع الملف (Excel/CSV)
  2. **Detect File** — اكتشاف نوع الملف، الترميز، الفاصل (delimiter)، الصفوف/الأعمدة
  3. **Column Mapping** — مطابقة أعمدة الملف بحقول الكيان (heuristics أولًا، AI اختياري للتحسين)
  4. **Data Cleaning** — تطبيع القيم، إزالة المسافات/التكرار، تصحيح الصيغ
  5. **Validation** — محرك تحقق (Validation Engine) يفحص القيم المطلوبة، الأنواع، القيود المرجعية (foreign keys)، القيود التجارية
  6. **Preview** — معاينة الاستيراد (Import Preview) قبل التنفيذ الفعلي، إظهار الصفوف الصحيحة/الخاطئة
  7. **Import** — التنفيذ الفعلي (transactional)
  8. **Report** — تقرير الاستيراد (Import Report): عدد الناجح/الفاشل/المتجاوز، تفاصيل الأخطاء
  9. **Rollback** — دعم التراجع الكامل عن استيراد سابق بالكامل

## مكوّنات إلزامية بالتصميم
- **Import History** — سجل لكل عمليات الاستيراد السابقة (من، متى، كم سجل، نتيجة).
- **Rollback support** — إمكانية التراجع عن استيراد كامل دون التأثير على بيانات لم تُلمس.
- **Entity Matching** — مطابقة السجلات المستوردة بسجلات موجودة فعليًا (تجنّب التكرار، تحديث بدل إنشاء عند التطابق).
- **Validation Engine** — محرك تحقق عام قابل لإعادة الاستخدام بين الكيانات (لا محرك مخصص لكل كيان).
- **Import Preview** — معاينة قبل التنفيذ.
- **Import Report** — تقرير تفصيلي بعد كل استيراد.

## ملاحظة معمارية إضافية (مُضافة يونيو 29, 2026): Entity-agnostic + Provider-agnostic
- **Entity-agnostic إلزاميًا**: الموديول **لا يجوز** أن يُربَط (coupled) بمنطق خاص بـProducts أو Warehouses أو Customers أو أي كيان محدد داخل core الـpipeline نفسه. كل كيان جديد (حالي أو مستقبلي) يُسجَّل (register) كـ"importer" عبر تعريف schema/mapping/validation rules خاصة به فقط — بدون لمس أو تعديل pipeline الاستيراد المشترك. الهدف: أي موديول مستقبلي (مثلًا POS Products، Manufacturing BOM إذا نُفِّذت Phase 13، إلخ) يمكنه تسجيل importer خاص به بأقل جهد، دون إعادة بناء أي جزء من الـcore.
- **Provider-agnostic إلزاميًا لطبقة AI الاختيارية**: طبقة الذكاء الاصطناعي (المذكورة أعلاه كاختيارية فوق الـheuristics) **لا يجوز** أن تعتمد على مزوّد واحد محدد (Claude/OpenAI/Gemini/إلخ) بشكل مباشر داخل الـpipeline. يجب أن تُنفَّذ خلف طبقة تجريد (abstraction interface) عامة — مثل `AiMappingProvider` أو ما شابه — بحيث يمكن إضافة مزوّد جديد، استبدال مزوّد قائم، أو تعطيل الطبقة بالكامل (الرجوع لـheuristics فقط) **دون أي تغيير على pipeline الاستيراد نفسه**.
- **قابلية التوسّع بمصادر الاستيراد**: التصميم الأساسي (خصوصًا مرحلة "Detect File" و"Upload" بالـpipeline) يجب أن يُبنى من البداية بافتراض أن Excel/CSV هما **أول مصدرين فقط، وليس الوحيدين**. مصادر مستقبلية محتملة يجب أن تتوافق مع نفس الـpipeline دون إعادة تصميمه: Google Sheets، JSON، XML، REST APIs خارجية، Shopify، WooCommerce، Odoo، SAP، أدوات ترحيل ERP أخرى. **Phase 14 عند تنفيذها الفعلي ستبدأ بـExcel/CSV فقط** — لكن البنية المعمارية (واجهة `ImportSource`/`FileAdapter` أو ما يعادلها) يجب أن تُصمَّم بحيث تسمح بإضافة مصدر جديد كـadapter جديد فقط، لا كإعادة بناء.
- **الخلاصة المعمارية**: ثلاث طبقات تجريد إلزامية بالتصميم منذ البداية — (1) تجريد الكيان (entity/importer registration)، (2) تجريد مزوّد AI (provider abstraction)، (3) تجريد مصدر الملف/البيانات (import source adapter). الثلاثة لا يجوز كتابتها كحلول خاصة (hardcoded) لأول كيان/مزوّد/مصدر يُنفَّذ فعليًا.

## لماذا مؤجَّلة (وليست مرفوضة)
تعتمد هذه الميزة على schemas ومنطق تحقق business-rules ناضجة لكل الكيانات المستهدفة (Products، Warehouses، Locations، Customers، Suppliers). تنفيذها قبل استقرار هذه الموديولات الأساسية يعني بناء إطار مطابقة/تحقق على أساس متحرك (moving target)، وإعادة عمل متكررة كل مرة يتغير schema كيان أساسي. **القرار: تُنفَّذ كمرحلة (Phase) مستقلة لاحقة بعد اكتمال واستقرار ERP الأساسي**، لا كجزء من Phase 2/3 الحالية لـInventory.

## الحالة النهائية لهذا القسم
وثيقة تخطيط فقط، بدون أي تنفيذ. يُحدَّث هذا القسم (لا يُحذف ولا يُستبدل) عند بدء التنفيذ الفعلي مستقبلًا، مع الإشارة الصريحة لهذا القسم كأساس التصميم المتفَق عليه.
- بنود Phase 2 المتبقية بعد هذا: تسلسل هرمي للوحة التحكم (Dashboard hierarchy)، رسوم بيانية لوحدة التقارير، تحسينات صفحة تفاصيل التحويل، نافذة "إنشاء منتج سريع" (Enhancement-001).

---

# 54. تلوين تفاوتات الجرد حسب الاتجاه (أخضر/أحمر/محايد) + توحيد zebra striping بجدول عناصر الجرد — يونيو 29, 2026

## السياق
من بنود Phase 2 UX المتبقية (راجع §52): جدول قوائم الجرد كان يُظهر `items_with_variance` و`net_variance_quantity` بلون عنبري واحد (amber) فقط لوجود تفاوت، دون تمييز بصري بين "زيادة" (overage) و"نقص" (shortage) — وهو تمييز مهم لوضوح الأعمال (business clarity) عند مسح القائمة سريعًا.

## التنفيذ (sefayv1.0.2 فقط — لا تغييرات backend)
- `StockCountsTable.tsx`:
  - عمود `net_variance_quantity` بجدول الديسكتوب: أصبح أخضر (`text-emerald-600/400`) عند > 0، أحمر (`text-red-600/400`) عند < 0، رمادي محايد عند = 0 (بدل رمادي ثابت دائمًا)، مع علامة `+` للقيم الموجبة.
  - بطاقة الموبايل: نص `items_with_variance` أصبح يتبع نفس منطق الاتجاه (أخضر/أحمر) بدل عنبري ثابت، مع الحفاظ على العنبري فقط كحالة احتياطية محايدة.
- `StockCountItemsTable.tsx` (جدول تفاصيل عناصر الجرد بصفحة التفاصيل): أُضيف "صفوف متبادلة الألوان" (zebra striping) ليتطابق مع كل جداول المخزون الأخرى (كان الجدول الوحيد المتبقي بدونها بعد توحيد §52).
- لم يلزم أي تغيير بالـ types أو الـ backend — الحقول (`net_variance_quantity`, `items_with_variance`) كانت موجودة فعليًا من migration 034/§52؛ هذا تحسين عرض فرونت إند بحت فوق بيانات موجودة.

## التحقق
- `npx tsc --noEmit` نظيف.
- `npm run build` نظيف (production build كامل، كل المسارات تُبنى بنجاح).

## الحالة النهائية
- PR مدموج على `sefayv1.0.2` (#12) — Vercel deployment check نجح (`state: success`) قبل الدمج (squash) على `main`.
- لا تغييرات backend أو migrations بهذا البند.
- بنود Phase 2 المتبقية: تسلسل هرمي للوحة التحكم (Dashboard hierarchy)، رسوم بيانية لوحدة التقارير، تحسينات صفحة تفاصيل التحويل، نافذة "إنشاء منتج سريع" (Enhancement-001).

---

# 55. تسلسل هرمي للوحة تحكم المخزون (Key Metrics → Status & Alerts → Timeline) — يونيو 29, 2026

## السياق
من بنود Phase 2 UX المتبقية (راجع §52/§54): شبكة الـKPI بلوحة تحكم المخزون كانت 10 بطاقات بنفس الوزن البصري بدون تمييز بين المؤشرات الجوهرية (قيمة المخزون، المنتجات المتوفرة...) والمؤشرات التشغيلية/التنبيهية (نواقص، أوامر شراء معلّقة...)، وقائمة "آخر الحركات" كانت قائمة مسطّحة بدون أي طابع "نشاط زمني" (timeline) فعلي.

## التنفيذ (sefayv1.0.2 فقط — لا تغييرات backend)
- `InventoryDashboardPage.tsx`:
  - تقسيم شبكة الـKPI إلى طبقتين بصريتين: **"Key Metrics"** (4 بطاقات كبيرة: قيمة المخزون، المنتجات المتوفرة، إجمالي المستودعات، المخزون المحجوز) و **"Status & Alerts"** (صف بطاقات مصغّرة: نواقص، نفاد، أوامر شراء/استلام معلّقة، حركات/تسويات اليوم).
  - إضافة متغيّر `size="sm"` لمكوّن `KpiCard` لدعم البطاقات المصغّرة دون تكرار المنطق.
  - إعادة تصميم قائمة "آخر الحركات" كخط زمني فعلي (نقطة + خط رابط عمودي) بدل قائمة مسطّحة.
  - مفتاحا i18n جديدان (`keyMetrics`, `statusAlerts`) بـ`inventory.json` (عربي/إنجليزي).
- لا تغييرات على الـ backend أو الـ types أو الـ API — تحسين عرض فرونت إند بحت فوق بيانات `useInventoryDashboard` الموجودة فعليًا.

## التحقق
- `npx tsc --noEmit` نظيف.
- `npm run build` نظيف (production build كامل).

## الحالة النهائية
- PR مدموج على `sefayv1.0.2` (#13) — Vercel deployment check نجح (`state: success`) قبل الدمج (squash) على `main`.
- لا تغييرات backend أو migrations بهذا البند.
- بنود Phase 2 المتبقية: رسوم بيانية لوحدة التقارير، تحسينات صفحة تفاصيل التحويل، نافذة "إنشاء منتج سريع" (Enhancement-001).

---

# 56. ⏸️ Phase مستقبلية مؤجَّلة — Storage Infrastructure & Abstraction — يونيو 29, 2026

## الحالة
**لم يبدأ التنفيذ. هذه وثيقة تخطيط (roadmap) فقط — لا كود، لا migrations، لا موديول حتى الآن.** هذا القسم يُسجّل التصميم المتفَق عليه قبل البدء، حتى لا يُفقَد القرار الهندسي إذا تأخر التنفيذ لعدة أشهر.

## ⚠️ ليست جزءًا من مرحلة المخزون الحالية
هذه ميزة **مستقلة تمامًا** عن Inventory Phase 2/3 الجارية حاليًا (راجع §52 وما قبله) ومستقلة أيضًا عن Smart Data Import Center (§53/PHASE 14). **لن يبدأ تنفيذها إلا بعد اكتمال واستقرار موديولات ERP الأساسية** (المخزون، المشتريات، نقاط البيع، العملاء، الفواتير، إلخ). ذُكرت هنا فقط لتثبيت التصميم المتفَق عليه بالذاكرة الهندسية للمشروع قبل أن يُنسى.

## الهدف
جعل المشروع بالكامل **مستقلًا عن مزوّد التخزين** (storage-provider agnostic). منطق الأعمال (business logic) لا يجوز أن يعتمد مباشرة على Supabase Storage أو أي مزوّد آخر — يجب أن يمرّ دائمًا عبر طبقة تجريد عامة.

## البنية المعمارية المتفَق عليها
طبقة تخزين عامة: `core/storage`
- **`StorageProvider`** — واجهة (interface) يُنفّذها كل مزوّد على حدة.
- **`StorageService`** — الواجهة الوحيدة التي يستخدمها بقية الكود؛ تُفوّض (delegates) للمزوّد النشط فقط.
- **`StorageModule`** — موديول NestJS يُسجّل المزوّد النشط حسب الإعداد.

**المزوّدون المخطَّط لهم:**
- Supabase Storage (أول تنفيذ فعلي)
- AWS S3
- Cloudflare R2
- MinIO
- Azure Blob
- Local Storage (اختياري — للتطوير المحلي/الاختبار)

التغيير بين المزوّدين يجب أن يكون **تغيير المزوّد النشط فقط** — منطق الأعمال لا يتغيّر أبدًا.

## واجهة التخزين (Storage Interface)
الطبقة التجريدية يجب أن تعرض على الأقل:
- `upload()`
- `download()`
- `delete()`
- `exists()`
- `move()`
- `copy()`
- `createSignedUrl()`
- `getPublicUrl()`

يجوز إضافة دوال مستقبلية دون تعديل أي موديول مستهلِك (consumer) لها.

## الإعداد (Configuration)
يُختار المزوّد النشط عبر متغيّر بيئة (environment variable):
```
STORAGE_DRIVER=supabase
```
ومستقبلًا، للتبديل لمزوّد آخر:
```
STORAGE_DRIVER=s3
```
بدون أي تعديل على كود التطبيق.

## نطاق التغطية — المشروع بالكامل
هذه البنية يجب أن تغطّي في النهاية **كل ملف يستخدمه Sefay**، بما يشمل:
- صور المنتجات
- صور العملاء
- صور الموردين
- شعارات الشركة (company logos)
- المرفقات (attachments)
- المستندات (documents)
- العقود (contracts)
- مستندات الشراء
- مستندات المبيعات
- مستندات المخزون
- التقارير
- تصدير PDF
- ملفات Import Center المرفوعة (راجع §53/PHASE 14)
- ملفات النسخ الاحتياطي (backups)
- أي نوع ملف مستقبلي

كل هذه الأنواع يجب أن تمرّ عبر `StorageService` فقط — بلا استثناء، وبلا تنفيذ مباشر لأي مزوّد داخل موديول كيان معيّن.

## استراتيجية قاعدة البيانات
**لا تُخزَّن روابط (URLs) خاصة بمزوّد معيّن في قاعدة البيانات.** تُخزَّن مراجع مستقلة عن المزوّد فقط، مثل:
- `bucket`
- `path`
- `storage_key`

المزوّد هو من يُولّد الرابط الفعلي ديناميكيًا وقت الحاجة (عبر `createSignedUrl()`/`getPublicUrl()`) — لا تُجمَّد الروابط بقاعدة البيانات أبدًا، لأن ذلك يكسر أي ترحيل مستقبلي بين المزوّدين.

## استراتيجية الترحيل (Migration Strategy) — بدون توقف خدمة
يجب أن يُصمَّم النظام منذ البداية ليدعم ترحيلًا بدون أي توقف خدمة (zero-downtime)، عبر:
- **Dual storage mode** — القراءة/الكتابة من مزوّدين في آنٍ واحد أثناء الترحيل.
- **Background migration jobs** — نقل الملفات تدريجيًا دون التأثير على الاستخدام الحي.
- **Verification** — تأكيد تطابق الملف المنقول (checksum أو ما يعادله) قبل اعتباره منقولًا بنجاح.
- **Automatic fallback** — إن فشلت القراءة من المزوّد الجديد، رجوع تلقائي للمزوّد القديم دون كسر تجربة المستخدم.
- **Progressive migration** — ترحيل تدريجي (بالكيان/بالـbucket/بالدُفعة) لا ترحيل دفعة واحدة.
- **Final cutover** — قطع نهائي للمزوّد القديم فقط بعد التأكد الكامل من نجاح الترحيل والتحقق.

العملاء (tenants) لا يجوز أن يشعروا بأي توقف أو خطأ خلال أي ترحيل مزوّد مستقبلي.

## الترحيل المستقبلي (Future Migration)
ترحيل مستقبلي من Supabase Storage إلى AWS S3 (أو أي مزوّد آخر) يجب أن يتطلّب فقط:
1. تنفيذ المزوّد الجديد (`StorageProvider` تنفيذ جديد).
2. نقل الملفات (copy objects).
3. تغيير `STORAGE_DRIVER`.
4. التحقق (verification).

**بدون أي تغيير في منطق الأعمال.**

## لماذا مؤجَّلة (وليست مرفوضة)
بناء طبقة تخزين عامة قبل اكتمال واستقرار الموديولات الأساسية (المنتجات، العملاء، الموردين، المشتريات، المبيعات، التقارير...) يعني تصميم الطبقة على أساس متحرك (moving target) لأنواع الملفات والاستخدامات الفعلية لم تتحدد جميعها بعد. **القرار: تُنفَّذ كبنية تحتية أساسية (foundational infrastructure investment) بعد اكتمال الموديولات الأساسية لـERP**، تمكّن التوسّع المستقبلي والاستقلالية عن المزوّد، لا كجزء من Phase 2/3 الحالية لـInventory.

## الحالة النهائية لهذا القسم
وثيقة تخطيط فقط، بدون أي تنفيذ. يُحدَّث هذا القسم (لا يُحذف ولا يُستبدل) عند بدء التنفيذ الفعلي مستقبلًا، مع الإشارة الصريحة لهذا القسم كأساس التصميم المتفَق عليه.
