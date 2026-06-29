# TASKS.md — Sefay V1.02
# آخر تحديث: June 26, 2026 (Sidebar Hamburger Fix — منشور)

---

## الوضع الحالي

| المرحلة | الحالة |
|---|---|
| Backend Core (A→H) | ✅ مكتمل |
| Frontend Wiring (7/7 modules) | ✅ مكتمل |
| CI/CD + Railway + Vercel | ✅ مكتمل |
| Database Migrations | ✅ مكتمل |
| Staging Environment | ✅ مكتمل |
| Security Headers (Helmet) | ✅ مكتمل |
| Phase 9F — Production Go-Live | ✅ مكتمل |
| Dark Mode — كل الصفحات | ✅ مكتمل (خلفية الصفحة + السايدبار أُصلحا — كانا ثابتين فاتح فقط — June 25, 2026) |
| Responsive Design — كل الصفحات | ✅ مكتمل (جداول → بطاقات موبايل + إصلاح ارتفاع بوس — June 25, 2026) |
| Date Picker في OrdersPage | ✅ مكتمل |
| | Expense Cancellation | ✅ مكتمل |
| رمز الريال — تم التراجع مؤقتًا لـ "ر.س" نصي (دعم خطوط الموبايل لـ U+20C1 غير مكتمل) | ✅ حل مؤقت مطبّق — June 24, 2026 |
| Expenses Bugs Fix (sidebar + dashboard) | ✅ مكتمل — June 22, 2026 |
| Dashboard Prototype | ✅ مكتمل (sefay-dashboard.html) |
| Landing Page Prototype | ✅ مكتمل (sefay-landing.html) |
| Onboarding Wizard Prototype | ✅ مكتمل (sefay-onboarding.html) |
| Recurring Expenses Scheduler | ✅ مكتمل فعليًا — June 25, 2026 (كان `processRecurringExpenses()` مبنيًا بالكامل لكن غير مستدعى من أي cron — تم ربطه بـ `EVERY_DAY_AT_MIDNIGHT` في `expenses.scheduler.ts`. راجع STATUS.md §38) |
| Dynamic platform (activity — 37 نشاط دقيق بدل 6 فئات) | 🔶 **لم تنتهِ بصدق، لكن البنية منشورة فعليًا** — migration 015 طُبّقت على production + الكود دُفع (api `178f5b2`، web `ef51be2`، June 26, 2026). البنية تتعقّب النشاط الدقيق من Onboarding بدل تحويله لـ6 فئات عريضة. **لا يوجد أي تمييز فعلي بالسايدبار** — كل الأنشطة تتطابق تمامًا (POS يبقى للجميع بلا استثناء بقرار المستخدم). التمييز الحقيقي معلّق بانتظار بناء ميزات جديدة فعلية تحتاجه أصلاً (مثال: "طاولات" Phase 10F، أو وحدة الإنتاج Phase 13). راجع STATUS.md §45 و §46 |
| Dashboard Layout Fix — مطابقة الـ prototype | ✅ مكتمل — June 24, 2026 |
| Fix Password Eye Icon | ✅ مكتمل — June 23, 2026 |
| Landing Page — Remove Popup | ✅ مكتمل — June 23, 2026 |
| Fix SuperAdmin Arabic Encoding | ✅ مكتمل — June 23, 2026 |
| Onboarding Route Fix | ✅ مكتمل — June 23, 2026 |
| Onboarding Real Registration (API + validation) | ✅ مكتمل — June 24, 2026 |
| Activity Step Redesign (cards بدل accordion) | ✅ مكتمل — June 24, 2026 |
| Feature/Settings Audit | ✅ مكتمل ومنشور — June 25, 2026 (commit `25b5d13` — راجع STATUS.md §42: ميزة `invoices_this_month` غير معروضة بالواجهة + hardcode عربي بـ SettingsPage.tsx/CustomerPickerModal.tsx/ReceiptModal.tsx + 4 ملفات expenses) |
| Mobile menu button display bug + background shorthand conflict + TenantStatusBadge i18n | ✅ مكتمل ومنشور — June 25, 2026 (commit `38856b8` — راجع STATUS.md §43) |
| Sidebar Links Fix | ✅ مكتمل — June 26, 2026 (لم تكن روابط مكسورة فعليًا — الباغ الحقيقي: زر الهامبرغر ☰ في `DashboardHeader.tsx` لا يختفي على الديسكتوب بسبب `display:'flex'` inline-style يتجاوز كلاس `lg:hidden`. راجع STATUS.md §43. تدقيق إضافي June 25/26: tenant sidebar + SuperAdmin sidebar + command palette + landing/login/onboarding كلها روابط سليمة فعليًا — الوجود الوحيد كان صفحة `dashboard/coming-soon` ميتة (صفر إحالات) — حُذفت بـ commit `133d1cd`) |
| رمز الريال ﷼ | ✅ مكتمل — June 22, 2026 |
| Dashboard Match Prototype + Responsive (طلب جديد) | ✅ مكتمل — June 25, 2026 (نفس بروتايب الداشبورد الرئيسية مطبّق على كل الصفحات) |
| توحيد لون البراند (#0C447C) — كل صفحات الداشبورد | ✅ مكتمل — June 25, 2026 |
| زر تسجيل الخروج في الداشبورد | ✅ مكتمل — June 25, 2026 |
| order_items FK (item_id/variant_id) RESTRICT → SET NULL | ✅ مكتمل — June 25, 2026 (migration 007 — راجع STATUS.md §37) |
| تنظيف i18n لمفتاح العملة الثابت غير المستخدم | ✅ مكتمل — June 25, 2026 |
| SuperAdmin — تحويل كامل لـ Light/Dark theme (toggle حقيقي، يطابق tenant dashboard) | ✅ مكتمل — June 25, 2026 (29 ملف + 6 إصلاحات لاحقة بعد الاستخدام الفعلي، راجع STATUS.md §41) |
| SuperAdmin — إصلاح bug ترجمة subscriptions.json (مفاتيح خام بدل نص) | ✅ مكتمل — June 25, 2026 |
| SuperAdmin — إصلاح فلاش غامق عند التنقل + white-on-white (auth-control stub + dropdown primitive) | ✅ مكتمل — June 25, 2026 |
| SuperAdmin — إزالة hardcode عربي من صفحة الإعدادات (namespace `superadmin.settings.*`) | ✅ مكتمل — June 25, 2026 |
| Mobile POS (pos_m) | ⬜ آخر شيء |
| Railway Build Failure (`nest: Permission denied`) | ✅ مُصلح نهائيًا — `npm ci` كان يتجاهل devDependencies بسبب `NODE_ENV=production` الذي يضبطه Nixpacks تلقائيًا أثناء التثبيت. الحل: `npm ci --include=dev` في `nixpacks.toml`. تم التحقق محليًا وعلى production. (4 محاولات إصلاح سابقة فشلت لأسباب أخرى — راجع STATUS.md §49) |
| Inventory Core (مخازن/مواقع/مخزون/تكاليف/حجوزات) | ✅ مكتمل بالكامل — backend + frontend، 17 migration (016–032)، يحلّ معظم بنود 10D أدناه |
| Purchasing Core (موردين/أوامر شراء/استلام بضاعة) | ✅ مكتمل بالكامل — يحلّ كل بنود 10E أدناه |
| Locations (مواقع فرعية داخل المخزن) | ✅ ميزة جديدة لم تكن مخطَّطة بهذه الوثيقة أصلاً — CRUD + بحث + ترقيم صفحات + ربطها بكل عمليات المخزون (تحويلات/تسويات/استلام/جرد) |

---

## 🚫 FRONTEND STATUS: FROZEN (تاريخي)
لا تاسكات frontend جديدة حتى اكتمال Phase A + B.
الصفحات الموجودة تبقى كما هي (prototype/mock).
يُستأنف ربط الـ frontend بعد وجود real endpoints.

---

## ✅ COMPLETED (web)
- إنشاء web/ — Next.js ✅
- هيكل المجلدات web/ ✅
- shared/ui كامل ✅
- shared/layout ✅
- SuperAdmin pages (17–23) ✅
- Tenant Dashboard pages (23–28) ✅
- Expenses Page ✅
- i18n ar/en كامل ✅
- Design System + tokens (قديم — بسيط) ✅
- Design System V2 + tokens (من الـ Prototypes) ⬜
| globals.css — CSS variables | ⬜ المرحلة 1 |
| tailwind.config.ts — design tokens | ⬜ المرحلة 1 |
| header.tsx — topbar navy gradient | ⬜ المرحلة 1 |
| DashboardSidebar.tsx — glass sidebar | ⬜ المرحلة 1 |
| stat-card.tsx — glass + stripe + sparkline | ⬜ المرحلة 2 |
| DashboardOverview.tsx — Hero Band | ⬜ المرحلة 2 |
| Chart cards — Recharts | ⬜ المرحلة 2 |
| Landing Page route | ⬜ المرحلة 3 |
| Onboarding Wizard route | ⬜ المرحلة 3 |
| Animations + Scroll reveal + Responsive | ⬜ المرحلة 4 |
- Production build + Vercel ✅
- Auth wiring — login/logout/me ✅
- Customers wiring ✅
- Shifts wiring ✅
- Expenses wiring ✅
- Orders/Invoices wiring ✅
- Items wiring ✅
- SuperAdmin wiring ✅
- Date Picker (DateRangePicker) ✅
- Orders date_from / date_to filter (backend + frontend) ✅
- Expense Cancellation (cancel + reverse approval + i18n) ✅
- SAR Symbol Font (SaudiRiyal.woff2) ✅

---

## ✅ PHASE A — Backend Core Runtime Foundation (مكتمل)

### A0 — Project Setup ✅
- [x] إنشاء api/ — NestJS
- [x] api/.env إعداد (في root المشروع — ليس في src/)
- [x] إعداد Supabase connection
- [x] هيكل المجلدات الكامل في api/
- [x] ConfigModule global
- [x] ValidationPipe global
- [x] CORS إعداد
- [x] npm run start:dev يشتغل بدون errors

### A1 — Supabase Module ✅
- [x] SupabaseModule (Global)
- [x] SUPABASE_CLIENT injection token
- [x] createSupabaseServiceClient()
- [x] اختبار الاتصال بـ Supabase

### A2 — TenantContext + ScopedRepository ✅
- [x] TenantContext class
- [x] ScopedRepository base class (بدون .select('*') — child يحدد)
- [x] GetTenant decorator
- [x] shared/types/enums.ts
- [x] shared/types/jwt-payload.type.ts
- [x] اختبار TenantContext يُنشأ صح

### A3 — JWT Auth Pipeline ✅
- [x] JwtStrategy (passport-jwt)
- [x] JwtAuthGuard
- [x] request.user injection
- [x] JWT validation (secret + expiry)
- [x] اختبار: request بدون token → 401
- [x] اختبار: request بـ token صح → request.user موجود

### A4 — TenantGuard ✅
- [x] TenantGuard (يعتمد على request.user من JwtAuthGuard)
- [x] SkipTenant decorator (SetMetadata — ليس Reflect.defineMetadata)
- [x] Superadmin bypass
- [x] branch_id من header (مؤقت)
- [x] اختبار: tenant user بدون tenant_id → 403
- [x] اختبار: superadmin → bypass

### A5 — Permission Engine ✅
- [x] إنشاء permissions table في Supabase
- [x] إنشاء role_permissions table في Supabase
- [x] PermissionGuard
- [x] @RequirePermission() decorator (SetMetadata)
- [x] PermissionsService (يقرأ من DB)
- [x] seed script: default permissions لكل role
- [x] اختبار: cashier يحاول invoice.cancel → 403
- [x] اختبار: owner يستطيع invoice.cancel → 200

### A6 — Feature Flags Runtime ✅
- [x] إنشاء features table في Supabase
- [x] إنشاء plan_features table في Supabase
- [x] إنشاء tenant_feature_overrides table في Supabase
- [x] FeatureFlagsService
- [x] resolveFeature(tenantId, featureKey): resolution chain صح
- [x] @RequireFeature() decorator
- [x] FeatureGuard
- [x] seed: default features
- [x] اختبار: tenant بدون feature → 403
- [x] اختبار: superadmin override يعمل

### A7 — Audit Layer ✅
- [x] إنشاء audit_logs table في Supabase
- [x] AuditService.log()
- [x] @Audit() decorator
- [x] AuditInterceptor (before + after + actor + ip + device + timestamp)
- [x] اختبار: عملية حساسة → سجل في audit_logs

### A8 — Security Hardening ✅
- [x] Rate limiting (throttler)
- [x] Helmet (security headers)
- [x] IP extraction middleware
- [x] تحقق branch ownership
- [x] تحقق user access to branch
- [x] استبدال x-branch-id header بـ validated branch context

---

## ✅ PHASE B — First Real API Endpoints (مكتمل)

### B1 — DB Tables ✅
- [x] device_sessions table
- [x] refresh_tokens table
- [x] permissions, features, plan_features, tenant_feature_overrides, audit_logs

### B2 — Auth Module ✅
- [x] POST /auth/login
- [x] POST /auth/logout
- [x] POST /auth/refresh (rotation)
- [x] GET /auth/me
- [x] POST /auth/revoke-session
- [x] device_sessions: إنشاء عند login
- [x] refresh_tokens: rotation صح

### B3 — Users Module ✅
- [x] GET /users
- [x] POST /users
- [x] PATCH /users/:id
- [x] DELETE /users/:id (soft)
- [x] role assignment
- [x] branch assignment
- [x] user limits per plan

### B4 — Branches Module ✅
- [x] GET /branches
- [x] POST /branches
- [x] PATCH /branches/:id
- [x] DELETE /branches/:id (soft)
- [x] branch limits per plan
- [x] validate branch belongs to tenant

### B5 — Items Module ✅
- [x] GET /items
- [x] POST /items
- [x] PATCH /items/:id
- [x] DELETE /items/:id (soft)
- [x] GET /items/:id/variants
- [x] POST /items/:id/variants
- [x] categories CRUD

### B6 — Invoices Module ✅
- [x] POST /invoices
- [x] GET /invoices
- [x] GET /invoices/:id
- [x] PATCH /invoices/:id/cancel
- [x] POS Engine integration
- [x] Audit على cancel
- [x] date_from / date_to filter ✅ (June 17, 2026)

### B7 — Frontend Wiring ✅
- [x] استبدال mock auth بـ real JWT
- [x] ربط login/logout
- [x] ربط /auth/me
- [x] استبدال mock data في Items
- [x] استبدال mock data في Invoices
- [x] permission-aware sidebar
- [x] feature-aware navigation

---

## ✅ PHASE C — Operational Modules (مكتمل)

### C1 — Billing Core ✅
- [x] plans table
- [x] subscriptions table
- [x] BillingService
- [x] plan limits enforcement
- [x] trial logic (14 days)
- [x] subscription status check

### C2 — Tenants Module (SuperAdmin) ✅
- [x] GET /superadmin/tenants
- [x] GET /superadmin/tenants/:id
- [x] PATCH /superadmin/tenants/:id/activate
- [x] PATCH /superadmin/tenants/:id/deactivate
- [x] PATCH /superadmin/tenants/:id/extend-trial
- [x] DELETE /superadmin/tenants/:id (soft)

### C3 — Expenses Module ✅
- [x] expense-templates CRUD
- [x] POST /expenses/request
- [x] PATCH /expenses/:id/approve
- [x] PATCH /expenses/:id/reject
- [x] expiry cron job
- [x] Audit على approve/reject

### C4 — Shifts Module ✅
- [x] POST /shifts/open
- [x] POST /shifts/close
- [x] GET /shifts/current
- [x] GET /shifts/:id/summary
- [x] cash reconciliation
- [x] Audit على open/close

### C5 — Customers Module ✅
- [x] CRUD /customers
- [x] GET /customers/:id/history
- [x] loyalty points logic

### C6 — Reports Module ✅
- [x] GET /reports/revenue
- [x] GET /reports/expenses
- [x] GET /reports/shifts
- [x] export PDF/Excel

### C7 — Frontend Wiring Phase 2 ✅
- [x] ربط Expenses بـ real API
- [x] ربط Shifts بـ real API
- [x] ربط Customers بـ real API
- [x] ربط SuperAdmin pages بـ real API
- [x] إزالة كل mock data

---

## ✅ PHASE D — Expansion (مكتمل جزئياً)
- [x] Analytics Engine ✅
- [x] Notifications (Email + InApp) ✅
- [ ] AI features — مؤجل V2
- [ ] Marketplace — مؤجل V2
- [ ] Push/SMS — مؤجل V2

---

## ✅ PHASE 9 — Production Readiness (مكتمل جزئياً)
- [x] 9A — Repository & Deployment Setup ✅
- [x] 9B — CI/CD Pipeline ✅
- [x] 9C — Database Migrations Strategy ✅
- [x] 9D — Staging Environment ✅
- [x] 9E — WAF & Network Security (Helmet + Rate Limiting) ✅

---

## 🔶 PHASE 9F — Production Checklist & Go-Live (تقريبًا مكتمل — June 25, 2026)

- [x] مراجعة environment variables على Railway — `STRIPE_SECRET_KEY` غير مضبوط على production، **أكّد المستخدم أنه مقصود** (لسه `PAYMENT_PROVIDER=mock`، لا مدفوعات حقيقية بعد)
- [x] التأكد من HTTPS على production — ✅ تم: API وFrontend كلاهما HTTPS مع HSTS، HTTP يحوّل تلقائيًا (301) لـ HTTPS
- [x] اختبار login + endpoints على production — ✅ تم: تسجيل، دخول صحيح/خاطئ (401 لا 500)، مسارات محمية (401 بدون توكن)، metrics عام (200)، superadmin/health محمي (401)، CORS يمنع origins غير معروفة
- [x] اختبار staging vs production isolation — ✅ تم: اكتُشِف أن staging متروك وغير مُستخدَم فعليًا (فرعه متأخر 16 يوم عن main، يستخدم نفس DB الإنتاج) → **قرار المستخدم: حذف**. تم حذف `.github/workflows/staging.yml` وفرع `staging` من GitHub (commit `aec829c`). **متبقٍ على المستخدم**: حذف خدمة Railway نفسها يدويًا من اللوحة
- [x] `RUNBOOK.md` — ✅ تم كتابته من الصفر (June 25, 2026): بنية تحتية، env vars، health checks، نشر/rollback، حوادث شائعة، ملاحظات staging
- [ ] Cloudflare WAF — مؤجل عمدًا حتى شراء domain خاص (قرار سابق موثّق بـ STATUS.md، ليس فجوة)
- [ ] إعلان Go-Live — معلّق فقط على: حذف خدمة `sefay-api-staging-production` من لوحة Railway يدويًا (المستخدم، خارج صلاحيات الأدوات المتاحة)

---

## ⬜ PHASE 10 — ميزات V1 الجديدة
**تبدأ بعد اكتمال 9F**
**المرجع: FEATURES.md**

### 10A — إصلاح Bugs مكتشفة (أولوية قصوى) ✅ مكتمل — June 25, 2026
- [x] إصلاح Stripe webhook — `billing_invoices` → `invoices` (تم التحقق: الكود يستخدم `invoices` بالفعل منذ commit `745ca84`، الوثيقة كانت قديمة)
- [x] تحقّق من باقي تضاربات SCHEMA_DECISION_MATRIX.md (B, C, D, E, F) — كلها مُصلَحة بالفعل في الكود الحالي
- [x] `shift_id` العمود كان موجودًا بالفعل بالجدول — السبب الحقيقي: `expenses.service.ts create()` لا يكتبه أبدًا. تم الإصلاح: `CreateExpenseDto` + الواجهة يرسلان `shift_id` من الشيفت الحالي المفتوح (`useCurrentShift`)
- [x] اختبار `getShiftExpenses()` على production — تم فعليًا: تينانت تجريبي → فتح شيفت (500) → مصروف (50) مع shift_id → اعتماد → ملخص أظهر totalExpenses=50, expectedCash=450 → إغلاق بـ450 → discrepancy=0 ✅ → حذف التينانت التجريبي (تأكد 401 عند تسجيل الدخول)

### 10B — طرق الدفع المتعددة (مؤجلة عمدًا — جُهّز نموذج البيانات فقط، June 25, 2026)
- [x] تجهيز schema/DTO لاستقبال: `mada`, `visa`, `mastercard`, `stc_pay`, `apple_pay`, `tab` — migration `006_expand_payment_methods.sql` (مطبّقة على production) + `CreateInvoiceDto` + اختبار حقيقي على production (إنشاء فاتورة بكل قيمة جديدة + تحقق ظهورها بـ `by_payment_method` بالتقارير تلقائيًا بلا أي كود إضافي)
- [x] Split Payment — كان موجودًا مسبقًا (`processSplitPayment`)
- [x] Tab (حساب مفتوح) — تمت إضافة تحقق: `customer_id` إلزامي عند `payment_method=tab` (لا نظام محاسبة/AR كامل بعد — فقط الوسم وربطه بعميل، مقصود ومحدود النطاق)
- [ ] Mada/Visa/Mastercard/STC Pay/Apple Pay — **لا تمييز معالجة فعلي بعد**: تُسجَّل كقيمة وسم فقط (الكاشير يسجّل الشبكة المستخدمة فعليًا على الجهاز الفعلي) — تُعامَل بنفس منطق `card` الحالي. لا تعديل بواجهة الكاشير (PaymentModal.tsx) حتى الآن — مقصود، تجنّبًا لعرض خيارات بلا فرق وظيفي فعلي
- [ ] ربط Moyasar (gateway حقيقي — مؤجل، لم يُبنَ أي abstraction مسبق له تجنّبًا لتصميم سابق لأوانه)
- [ ] ربط Tap (نفس الملاحظة أعلاه)

### 10C — Custom Customer Fields ✅ مكتمل ومُختبر فعليًا على production — June 25, 2026
- [x] جدول `customer_field_definitions` (migration 008 — مطبّقة على production DB)
- [x] API: CRUD حقول العميل (`/customer-field-definitions` — `customers.manage` permission)
- [x] إعداد: toggle `customer_capture_enabled` في Settings (`PATCH /tenant/profile`)
- [x] POS: Customer Lookup بأي حقل (بحث ديناميكي عبر `custom_fields->>key.ilike` على الحقول النشطة من نوع text/select)
- [x] POS: تسجيل عميل جديد عند البيع (`CustomerPickerModal` — نموذج ديناميكي حسب تعريفات الحقول + تحقق required)
- [x] حفظ قيم الحقول في قاعدة العملاء (`customers.custom_fields JSONB`)
- نُشر فعليًا (api + web) وتم اختبار كامل المسار على production (تسجيل/تفعيل/حقول/إنشاء عميل/بحث بأي حقل/فاتورة فعلية مرتبطة بعميل/تنظيف) — راجع STATUS.md §39
- باغ حقيقي #1 اكتُشف ومُصلح أثناء الاختبار: صلاحيات `service_role` على جدول `customer_field_definitions` (migration 009)
- باغ حقيقي #2 اكتُشف من تقرير المستخدم "لا تظهر عند الكاشير" ومُصلح: دور cashier كان ينقصه `settings.view`/`customers.manage` فعليًا — أُضيف `GET /tenant/pos-config` (صلاحية يملكها الكاشير) + `customers.manage` لدور cashier — أُعيد الاختبار بحساب cashier فعلي حقيقي وكل المسار يعمل
- [x] اكتُشف جانبيًا: 3 ملفات seed صلاحيات متضاربة بالمشروع — أُرسل كـ task منفصل (`task_b8029316`) لتوحيدها، خارج النطاق — **مكتمل June 25, 2026**: تأكّد أن `src/database/seeds/permissions.seed.ts` هو الوحيد المربوط بأي تشغيل تلقائي (`migrate.ts` import + `start:prod`/`seed:permissions`)؛ تم التحقق من صلاحيات `cashier` الفعلية على production عبر Supabase Management API مباشرة قبل أي تعديل (لا فرق سوى `branches.view` ممنوحة يدويًا خارج كل ملفات seed، لم تُلمَس). حُذف `src/seeds/permissions.seed.ts` (ميت فعليًا — صفر استدعاءات، وأيضًا غير متوافق مع الـ schema الفعلي: يستخدم عمود `key` بدل `name`). أُعيد بناء `src/seeds/full-setup.seed.ts` (يبقى مربوطًا بـ `npm run seed:full` اليدوي فقط) ليستورد `permissions`/`rolePerms` من الملف الفعلي بدل نسخة محلية متضاربة. مصدر حقيقة واحد الآن. راجع STATUS.md §40
- تصحيحان من المستخدم بعد المراجعة الحقيقية (June 25, 2026) ✅ مُصلحان ومُختبران: (1) full_name/phone كانا hardcoded إلزاميين بمعزل عن نظام الحقول — أصبحا الآن حقلين "أساسيين" ضمن نفس النظام، قابلين للتعطيل/جعلهما اختياريين بالكامل من المالك (migration 010 + حماية حذف/تغيير نوع) (2) ترتيب التدفق بـ POS كان خاطئًا (زر مستقل قبل الدفع) — أصبح: سلة → دفع → بحث/تسجيل عميل (إن كانت الميزة مفعّلة) → طريقة الدفع → تأكيد. راجع STATUS.md §39 للتفاصيل والاختبار الكامل
- **متبقٍ**: لم يُختبَر مسار POS بمتصفح حقيقي (فقط منطق الـ API المطابق له، بدور owner وبدور cashier فعليين)

### 10D — المخزون المتقدم
- [x] تحويل مخزون بين فروع — Transfers module كامل (timeline/progress UI)
- [x] جرد المخزون (Stock Count) — counts module كامل (progress/variance UI)
- [x] Reorder Point (تنبيه نقص المخزون) — schema + reporting RPCs (الحالة: مبني، لا تنبيه push/email تلقائي بعد — فقط ظاهر بالتقارير/الداشبورد)
- [x] Locations (مواقع فرعية داخل المخزن) — **بند جديد غير مخطَّط أصلاً، أُضيف ونُفِّذ بالكامل**: CRUD + بحث + ترقيم صفحات + audit logging، مربوط end-to-end بالتحويلات/التسويات/استلام البضاعة/أوامر الشراء/الجرد
- [ ] باركود وطباعة ملصقات — لم يُبنَ
- [ ] تاريخ انتهاء الصلاحية (batch/lot expiry tracking + تنبيهات) — جدول `batches` موجود بالـ schema لكن لا منطق انتهاء صلاحية/تنبيهات فعلي بعد
- [ ] COGS (تكلفة المنتج) — `cost_layers` موجودة بالـ schema (FIFO/weighted-avg layers)، لكن لا تقرير COGS مُجمَّع مكشوف بعد كـ endpoint
- [ ] Recipe / BOM (وصفات للمطاعم والكافيهات) — لم يُبنَ؛ **لا تخلطه مع Phase 13 (Production/Manufacturing)** أدناه — ذاك نطاق أوسع لمصانع حقيقية، هذا بند مختلف وأصغر لوصفات مطاعم بسيطة، لم يُقرَّر تنفيذه بعد

### 10E — الموردين والمشتريات ✅ مكتمل بالكامل
- [x] جدول `suppliers`
- [x] جدول `purchase_orders` + `goods_receipts`
- [x] API: CRUD الموردين + إحصائيات ملف المورد (outstanding POs, lead time, سجل الشراء)
- [x] API: أوامر الشراء (workflow + progress)
- [x] استلام البضاعة (Goods Receipts، شامل استلام جزئي) → تحديث المخزون تلقائياً عبر RPC ذرّية
- Frontend: صفحات أوامر الشراء + تفاصيل الاستلام + تحسينات ملف المورد — كلها منشورة

### 10F — الطاولات والطلبات (مطاعم/كافيهات)
- [ ] جدول `tables`
- [ ] جدول `table_orders`
- [ ] API: إدارة الطاولات
- [ ] API: طلبات per طاولة
- [ ] Kitchen Display System (KDS)
- [ ] حجز طاولة مسبقاً
- [ ] Waitlist

### 10G — برنامج الولاء والتسويق
- [ ] Loyalty Points (تجميع + استرداد)
- [ ] Loyalty Tiers
- [ ] بطاقات هدايا (Gift Cards)
- [ ] كوبونات وعروض (موجود جزئياً — مراجعة)

### 10H — الموارد البشرية
- [ ] حضور وغياب
- [ ] جدولة الموظفين
- [ ] عمولات مبيعات للموظفين

### 10I — التقارير المتقدمة
- [ ] تقارير مبيعات حسب طريقة الدفع (نقد/Mada/Visa/Mastercard/STC Pay/Apple Pay/Split/Tab)
- [ ] تقارير المخزون
- [ ] تقارير الموظفين
- [ ] تقارير العملاء
- [ ] تقارير ضريبية (ZATCA)
- [ ] تصدير Excel/PDF

### 10J — Dashboard تحليلي متقدم
- [ ] KPIs متقدمة (AOV / Conversion / Churn)
- [ ] مقارنات فترة vs فترة
- [ ] مقارنات فرع vs فرع
- [ ] Drill-down تفاصيل

### 10K — المالية والضرائب
- [ ] VAT إعداد per tenant
- [ ] عملات متعددة
- [ ] تسوية يومية
- [ ] ZATCA فوترة إلكترونية

### 10L — إعدادات المالك
- [ ] تخصيص الفاتورة (شعار / رقم ضريبي / تذييل)
- [ ] إعدادات الطابعة
- [ ] إعدادات التنبيهات

### 10M — إصلاح SuperAdmin Gaps
- [ ] endpoint: قائمة subscriptions للـ superadmin
- [ ] endpoint: إلغاء subscription
- [ ] endpoint: manual payment
- [ ] endpoints: Auth Control للـ superadmin

---

## ⬜ PHASE 11 — Mobile POS (pos_m)
**تبدأ بعد اكتمال Phase 10**

- [ ] E1 — Setup (Expo + SQLite + MMKV + Zustand)
- [ ] E2 — Auth + Sync Engine
- [ ] E3 — POS Engine (Offline)
- [ ] E4 — Expense Flow
- [ ] E5 — Shift Engine
- [ ] E6 — Printing Engine (Sunmi + Bluetooth)

---

## ⬜ PHASE 12 — V2 (مؤجل)
- AI features
- Marketplace
- WhatsApp Business
- منصات توصيل (Jahez / HungerStation)
- QR code self-order
- متجر إلكتروني
- QuickBooks integration
- باقي الأنشطة الـ 31

---

## ⏸️ PHASE 13 — Production / Manufacturing Module (مؤجّل عمدًا — بعد اكتمال المشروع بالكامل)

**قرار المستخدم (June 26, 2026): لا تُبنى الآن. تُبدأ فقط بعد انتهاء المشروع بالكامل (كل الفيزات السابقة).**

استهداف عملاء جدد للنظام: مصانع/شركات تصنيعية فعلية (وليس فقط الأنشطة الصغيرة الحالية الـ37). يتطلب:
- 9 أنشطة onboarding جديدة (قسم "التصنيع" — foodManufacturing/furnitureManufacturing/textileManufacturing/packagingManufacturing/generalManufacturing)
- وحدة إنتاج حقيقية: أوامر تصنيع (work orders) متعددة المراحل + مخزون قيد التصنيع (WIP) + Bill of Materials (BOM) مع تكلفة مواد متراكمة — **ليست** وصفة بسيطة "مكوّن=منتج" (رُفض هذا الخيار الأبسط صريحًا من المستخدم لصالح نطاق يناسب مصانع حقيقية)

**خطة تنفيذ كاملة ومفصّلة جاهزة فعليًا** (تمت بالكامل — بحث + تصميم + مراجعة الكود الحالي، عبر Plan Mode، ومُعتمَدة من المستخدم) محفوظة بـ:
`C:\Users\GAMER2026\.claude\plans\greedy-discovering-patterson.md`

تتضمن الخطة: مخطط DB كامل (جداول bill_of_materials/bom_components/bom_stages/production_orders/production_order_stages/production_order_materials + تعديلات items)، تصميم production-engine نقي (مطابق لنمط ApprovalEngine)، وحدة backend كاملة (production module — controllers/services/repositories/DTOs)، صلاحيات جديدة (production.view/manage)، واجهة frontend كاملة (BOM management + production orders + سايدبار مخصّص لأنشطة التصنيع فقط)، وخطة تحقق end-to-end كاملة (curl sequence).

> ⚠️ **تنبيه — رقم migration بالخطة المحفوظة قديم/غير صالح**: ملف الخطة يذكر "migration 016" لجداول BOM/الإنتاج. هذا الرقم **مُستخدَم فعليًا الآن** بـ`016_inventory_core.sql` (مدفوع ومطبَّق على production منذ بناء Inventory Core — راجع STATUS.md §50). **لا تستخدم 016 حرفيًا عند البدء**. عند تنفيذ Phase 13 فعليًا، تابع الترقيم من آخر migration مُطبَّقة فعليًا في `src/database/migrations/` في ذلك الوقت — حاليًا (هذا التحديث) آخر migration هي **032**، فالرقم الصحيح للبدء سيكون **033 فصاعدًا**. تحقّق دائمًا من المجلد الفعلي قبل افتراض أي رقم من ملف الخطة القديم.

**عند البدء فعليًا لاحقًا**: اقرأ ملف الخطة المحفوظ أولًا — يحتوي كل التفاصيل التقنية الدقيقة (أسماء أعمدة، مسارات ملفات، تسلسل API) ولا حاجة لإعادة البحث من الصفر، **باستثناء رقم migration** (راجع التنبيه أعلاه).

---

## Guard Execution Order (إلزامي — لا تغيير)
JwtAuthGuard → TenantGuard → PermissionGuard → FeatureGuard
لا تُسجّل أي guard كـ APP_GUARD قبل أن الـ guard قبله مكتمل ومختبر.

---

## مراجع
- ميزات المنتج الكاملة: FEATURES.md
- حالة المشروع: STATUS.md
- قرارات المعمارية: DECISIONS.md
- قواعد العمل: CLAUDE.md + rules.md