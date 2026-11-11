# TASKS.md — Sefay V1.02
# آخر تحديث: يوليو 8, 2026 (تصحيح توثيق شامل — راجع STATUS.md §72: عمل ضخم بـTables/Kitchen وHR كان منجزًا فعليًا منذ 4-8 يوليو لكن غير موثَّق هنا حتى الآن)

---

## 📜 سياسة هذا الملف
هذا الملف سجل هندسي كامل (logbook) مع STATUS.md، لا TODO list يُعاد كتابته. **لا حذف لأي بند أو خطة سابقة** (حتى المرفوضة/المؤجَّلة) — فقط تحديث حالتها (✅/🔄 استُبدل/⏸️ مؤجَّل/❌ مرفوض + السبب) وإضافة بنود جديدة بجانبها. عند الشك، أضِف قسمًا جديدًا ولا تَمحُ القديم. راجع سياسة STATUS.md (أعلى الملف) للتفاصيل الكاملة.

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
| Access Control System (tenant-aware permissions + admin UI) | ✅ مكتمل ومنشور — يوليو 7-8, 2026 (roles/tenant_role_permissions/permission_groups + `/access-control/*` API + صفحة `/dashboard/settings/access-control`). راجع STATUS.md §68. **غير مبني بعد**: إنشاء أدوار مخصصة، تعدد أدوار للمستخدم، نطاق فرع/قسم، استثناءات مستخدم فردية، سياسات، وصول مؤقت |
| فصل System User / Employee Core / Attendance (طبقة توافق تخزين + `is_employee_profile`) | ✅ مكتمل ومنشور — يوليو 7, 2026. راجع STATUS.md §69 (بما فيه توثيق حادثتي حذف سجلات موظفين حقيقيين بالخطأ أثناء اختبار الأزرار، وكيف عولجتا) و§70 (إصلاح واجهة تأكيد الحضور بالموبايل) |
| ⚠️ صفحتا الطاولات/المطبخ توقفتا (42501 — نفس عائلة خلل §48/§68) | ✅ أُصلح ومُنشَر — يوليو 8, 2026. migration 045 (منذ 3 يوليو) لم تُطبَّق على production حتى الآن، وعند تطبيقها أخيرًا ظهر نفس خلل الصلاحيات الناقصة. راجع STATUS.md §71 — **يتضمن قاعدة إلزامية جديدة**: كل migration تُنشئ جدولًا يجب أن تتضمن GRANT بنفس الملف |
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
| تغنية قوائم أوامر الشراء/استلام البضاعة/التحويلات/الجرد (migration 034) + توحيد zebra striping بكل جداول المخزون | ✅ مكتمل ومدموج — June 29, 2026 (PR api#21 + web#11 — راجع STATUS.md §52). ⚠️ migration 034 لم تُطبَّق على production/staging بعد |
| تلوين تفاوتات الجرد حسب الاتجاه (أخضر/أحمر/محايد) + zebra striping بجدول عناصر الجرد | ✅ مكتمل ومدموج — June 29, 2026 (PR web#12 — راجع STATUS.md §54). فرونت إند فقط، لا تغييرات backend |
| تسلسل هرمي للوحة تحكم المخزون (Key Metrics → Status & Alerts → Timeline) | ✅ مكتمل ومدموج — June 29, 2026 (PR web#13 — راجع STATUS.md §55). فرونت إند فقط، لا تغييرات backend |
| Inventory Recovery (post `git reset --hard` incident) — Items + Transfers contracts fixed, Adjustments/Goods Receipts/Stock Counts audited clean | ✅ مكتمل — August 3, 2026. راجع STATUS.md §107. Backlog: INV-001 (pagination standardization، Adjustments/Goods Receipts/Stock Counts)، INV-002 (error hardening، cancel/submitCount)، INV-003 (فحص فقط — items/stats 500 متقطع)، INV-004 (واجهة إدارة الفئات)، INV-005 (تسريب حالة نماذج الإنشاء — Warehouses/Locations) |

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
- [x] ✅ **Rate limiting لكل مستأجر ولكل IP معًا — يوليو 9, 2026** (راجع STATUS.md §75): كان الحد قديمًا "إما/أو" (tenant_id لو موجود، وإلا IP) — أي مهاجم يزوّر/يدوّر `tenant_id` بتوكن مزوَّر من نفس IP يحصل على دلو مستقل ٦٠٠/دقيقة بلا حد فعلي على الـIP نفسه. أُضيف throttler ثانٍ (`global-ip`) يعمل بالتوازي مع الأصلي، بحد **ديناميكي** = (عدد `tenant_id` مختلف شوهد فعليًا من نفس IP بآخر ~٦٠ ثانية، متتبَّع عبر Redis set) × ٦٠٠. مُدقَّق النوع/مبني محليًا، مُختبَر بمحاكاة Redis (٦/٦ نجحت)، **غير مدفوع لـ`main` بعد** بانتظار الموافقة.
- [x] ✅ **إصلاح `findById` يرمي 500 بدل 404 بـ17 ملف repository — يوليو 9, 2026** (راجع STATUS.md §75): اكتُشف أثناء اختبار إصلاح ملكية `customer_id`. السبب: `.single()` بدل `.maybeSingle()` — Postgrest يرمي خطأ خام عند 0 صفوف بدل إرجاع `null`، فيمنع منطق `NotFoundException` الموجود أصلًا بكل *service* من العمل. أُصلح بـ17 ملفًا (inventory×7، purchasing×3، items×2، invoices، tenants، customers×2). مدفوع (`e2dfb7a`) ومُتحقَّق منه حيًّا (404 نظيف بدل 500).

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
- [x] تاريخ انتهاء الصلاحية (batch/lot expiry tracking) — July 3, 2026: `GET /inventory/reports/expiring-batches` (+ مُضاف لـ`overview`) — migration 042، RPC `fn_batches_expiring_soon`. نفس نطاق reorder points تمامًا: تقرير/داشبورد فقط، **لا تنبيه push/email تلقائي** (قرار متعمّد مطابق للسابقة الموثَّقة). اختُبر فعليًا: تصنيف `expired`/`expiring_soon`/`ok` صحيح، فلترة `days_ahead` تعمل، البatches بصفر مخزون تُستبعَد صح
- [x] **POS ↔ Inventory disconnect** (الاكتشاف الحرج أدناه) ✅ **حُلّ — July 3, 2026**: `InvoicesService.create()` الآن يخصم المخزون فعليًا عند البيع (وأعاد بها الفواتير الملغاة). راجع STATUS.md §64 للتصميم الكامل. **القرار المتّخذ**: `branches.default_warehouse_id` (عمود جديد، اختياري، `NULL` افتراضيًا لكل فرع موجود = **لا تغيير سلوك إطلاقًا** حتى يربط المستأجر فرعًا بمستودع صراحة عبر `PATCH /branches/:id`، مع تحقق أمني من ملكية المستودع لنفس المستأجر) + إعادة استخدام `items.has_inventory` الموجود أصلًا لتحديد أي عنصر يُخصَم (الخدمات/العناصر غير المتتبَّعة تُتخطى بصمت). الخصم **best-effort** — مشكلة مخزون لا توقف بيعًا مكتمِلًا أبدًا (توصية متابعة لاحقة بـSTATUS.md §64 لتفعيل رفض صريح عند نقص المخزون بعد التأكد من جودة بيانات كل مستأجر)
- [x] COGS (تكلفة المنتج) ✅ **مكتمل — July 3, 2026**: `GET /reports/cogs` — إجمالي تكلفة المبيعات من `stock_movements` (`movement_type='sale'`، مصدر بيانات حقيقي الآن بعد إصلاح §64)، هامش ربح إجمالي، أعلى 10 أصناف تكلفة. **يتضمن `coverage_note` صريح بالرد نفسه**: COGS يعكس فقط العناصر المُتتبَّعة بمخزون مُعدّ فعليًا، بينما الإيراد يشمل كل المبيعات — فالهامش قد يبدو أعلى من الحقيقي حتى يُفعَّل تتبع المخزون بالكامل لكل عناصر المستأجر. اختُبر فعليًا: التكلفة الإجمالية طابقت تمامًا الكمية المباعة × التكلفة الفعلية
- [ ] Recipe / BOM (وصفات للمطاعم والكافيهات) — لم يُبنَ؛ **لا تخلطه مع Phase 13 (Production/Manufacturing)** أدناه — ذاك نطاق أوسع لمصانع حقيقية، هذا بند مختلف وأصغر لوصفات مطاعم بسيطة، لم يُقرَّر تنفيذه بعد

### 10E — الموردين والمشتريات ✅ مكتمل بالكامل
- [x] جدول `suppliers`
- [x] جدول `purchase_orders` + `goods_receipts`
- [x] API: CRUD الموردين + إحصائيات ملف المورد (outstanding POs, lead time, سجل الشراء)
- [x] API: أوامر الشراء (workflow + progress)
- [x] استلام البضاعة (Goods Receipts، شامل استلام جزئي) → تحديث المخزون تلقائياً عبر RPC ذرّية
- Frontend: صفحات أوامر الشراء + تفاصيل الاستلام + تحسينات ملف المورد — كلها منشورة

### 10F — الطاولات والطلبات (مطاعم/كافيهات) ✅ مكتمل (backend) — July 3, 2026
- [x] جدول `tables` — مع status (available/occupied/reserved/cleaning)، unique index (tenant+branch+name)
- [x] **قرار تصميم بدل `table_orders` منفصل**: أُعيد استخدام جدولي `orders`/`order_items` الموجودين (عمود جديد `orders.table_id` + حالة `'pending'` كانت موجودة بالـCHECK constraint منذ البداية لكن غير مستخدَمة) بدل بناء كيان موازٍ بالكامل — طلب الطاولة المفتوح **هو** فعليًا Order يبقى مفتوحًا عبر عدة جولات إضافة قبل التحصيل النهائي، فأعاد استخدام محرك POS/الدفع/خصم المخزون الموجود بالكامل بدل تكراره
- [x] API: إدارة الطاولات — `GET/POST/PATCH/DELETE /tables` (409 عند تكرار الاسم بنفس الفرع، يمنع حذف طاولة مشغولة)
- [x] API: طلبات per طاولة — `POST /tables/:id/open`، `POST /tables/:id/items` (إضافة جولة، يعيد حساب subtotal/tax/total كاملًا كل مرة)، `GET /tables/:id/order`، `POST /tables/:id/checkout` (نفس تحقق الدفع كالفواتير العادية، يحرّر الطاولة، يشغّل نفس خصم المخزون best-effort من إصلاح §64)
- [x] Kitchen Display System (KDS) — عمود جديد `order_items.kitchen_status` (pending/preparing/ready/served)، `GET /kitchen/orders` (كل الطلبات المفتوحة + عناصرها)، `PATCH /kitchen/items/:id`
- [x] حجز طاولة مسبقاً — جدول `table_reservations` كامل (CRUD)، تحديد حالة "seated" يشغل الطاولة تلقائيًا
- [x] Waitlist — جدول `waitlist_entries`، إنشاء/إلغاء/تعيين طاولة (يتحقق أن الطاولة متاحة فعليًا قبل القبول)
- صلاحيتان جديدتان: `tables.manage` (owner/manager/cashier)، `kitchen.manage` (owner/manager/cashier/worker — العامل بالمطبخ قد يكون بدور worker)
- اختُبر end-to-end بتدفق حقيقي كامل: إنشاء طاولة (+409 عند التكرار)، فتح، جولتا إضافة عناصر (تراكم صحيح تمامًا: 75/11.25/86.25)، KDS يعرض الطلب الحي، تغيير حالة العناصر (+رفض حالة غير صالحة)، تحصيل (خصم مخزون مؤكَّد فعليًا، الطاولة تتحرر)، منع حذف طاولة مشغولة، منع حجز/waitlist لطاولة مشغولة، رفض مرجع طاولة عابر للمستأجرين
- [x] ✅ **تصحيح — يوليو 8, 2026 (راجع STATUS.md §72)**: البند التالي كان خاطئًا: ~~"لا واجهة frontend بعد لأي جزء"~~. الواجهة **مبنية ومنشورة بالكامل فعليًا** منذ 4-5 يوليو (commits `4e52870`, `dc7bdfc`) — `TablesPage`/`TableCard`/`CreateTableModal`/`DineInModal`/`KitchenPage`، مسجَّلة بالسايدبار (`/dashboard/tables`, `/dashboard/kitchen`). لم يُوثَّق بهذا الملف وقتها — اكتُشف بفحص مباشر للكود لاحقًا

### 10G — برنامج الولاء والتسويق (جزئي — Loyalty Points فقط، July 3, 2026)
- [x] Loyalty Points (تجميع + استرداد) — `LoyaltyService` (core/loyalty) جديد + migration 041 (`loyalty_points_per_currency`/`loyalty_redemption_value` على tenants + RPC ذرّي `fn_adjust_loyalty_points` لمنع race condition عند استرداد متزامن). مربوط بـ`InvoicesService.create()`: `redeem_points` اختياري بـ`CreateInvoiceDto` يُطبَّق كخصم (يُتحقق من الرصيد، يُدمَج مع أي خصم يدوي)، والنقاط تُكتسَب على المبلغ **بعد** أي استرداد (لمنع "إعادة تدوير" النقاط). الإعدادات مكشوفة عبر نفس `PATCH /tenant/profile` من 10L. عمود `customers.loyalty_points` كان موجودًا من البداية لكن يبقى صفرًا دائمًا (لا كود كان يحدّثه) — الآن يعكس تراكمًا حقيقيًا. اختُبر end-to-end فعليًا (حساب النقاط/الخصم/الرصيد المتبقي مطابق للحساب اليدوي، رفض استرداد أكبر من الرصيد، رفض بلا customer_id). **لا واجهة استرداد بالـPOS بعد** — القدرة موجودة بالـAPI فقط، عرض النقاط بصفحة العملاء موجود مسبقًا ويعمل الآن بأرقام حقيقية
- [x] ✅ **Loyalty Tiers — مكتمل يوليو 8, 2026** (راجع STATUS.md §74): عمود `customers.lifetime_points_earned` (migration 069، ينمو فقط عند الاكتساب) + جدول `loyalty_tiers` (tenant-scoped) + `LoyaltyService.getTierMultiplier()` مربوط بـ`InvoicesService.create()` + واجهة إدارة الفئات مدمجة بصفحة الإعدادات (`LoyaltyTiersManager`)
- [x] ✅ **بطاقات هدايا (Gift Cards) — مكتمل يوليو 8, 2026** (راجع STATUS.md §74): جدول `gift_cards` (migration 070) + `modules/gift-cards/` backend كامل (توليد كود تلقائي، تحقق/استرداد ذرّي عبر RPC) + دمج بـ`InvoicesService.create()` (تسديد جزء/كامل الفاتورة مباشرة قبل حساب طريقة الدفع) + صفحة `/dashboard/gift-cards` frontend كاملة (owner/manager)
- [x] ✅ **كوبونات وعروض — مكتمل يوليو 8, 2026** (راجع STATUS.md §73): جدول `coupons` (migration 068) + `modules/coupons/` backend كامل (CRUD + validate/redeem ذرّي عبر RPC) + دمج بـ`InvoicesService.create()` + صفحة `/dashboard/coupons` frontend كاملة (owner/manager). ~~**متبقٍ**: لا حقل إدخال كود كوبون بشاشة الدفع بالـPOS بعد~~ — **أُنجز يوليو 9** (راجع البند أدناه و STATUS.md §77)
- [x] ✅ **إصلاح 4 ثغرات بمسار الدفع — يوليو 8, 2026** (راجع STATUS.md §74): (1) تجاوز الكود البديل (`%`) بالكوبون/بطاقة الهدايا عبر `ilike` — أُصلح بمطابقة `eq` حصرية، (2) تسريب نقاط ولاء بين المستأجرين (لا فلترة `tenant_id` بالبحث عن العميل) — أُصلح بتحقق ملكية صريح، (3) لا سقف 100% لكوبون النسبة المئوية — أُصلح بـ`@Max(100)` الشرطي، (4) لا تحقق من ملكية `customer_id` للمستأجر عند إنشاء أي فاتورة عمومًا — أُصلح باستدعاء `CustomersService.findById`. **الأربعة كلها مدفوعة ومُتحقَّقة حيًّا على production** (الرابع اختُبر لاحقًا بنفس اليوم — راجع STATUS.md §75)
- [x] ✅ **مفتاح تفعيل/تعطيل برنامج الولاء — يوليو 9, 2026** (راجع STATUS.md §77): عمود `tenants.loyalty_enabled` (migration 071، افتراضي true). عند التعطيل: `redeem_points` يُرفض برسالة واضحة، لا اكتساب نقاط إطلاقًا، مربع الاسترداد يختفي من POS، وحقول الإعدادات/مدير الفئات تُخفى مع زر تبديل بصفحة الإعدادات. **قرار مثبَّت**: بطاقة الهدايا تكتسب نقاط ولاء (فلوس حقيقية دُفعت مسبقًا)؛ استرداد النقاط والكوبون لا يكتسبان
- [x] ✅ **واجهة POS للكوبون + بطاقة الهدايا مع معاينة حية — يوليو 9, 2026** (راجع STATUS.md §77): حقل كوبون بالسلة (كان موجودًا لكن ميتًا — الكود المكتوب كان يُسقط بصمت) + بطاقة هدايا بشاشة الدفع. نقطتان جديدتان `POST /coupons/validate` و`POST /gift-cards/validate` (معاينة بدون استهلاك، بصلاحية `invoice.create.own`) — الكود لا يُعرض "مطبَّقًا" إلا بعد تأكيد السيرفر، والخصم الحقيقي يظهر بالسلة/الدفع/الإيصال، وأي تعديل بالسلة يلغي الكوبون تلقائيًا لإعادة التحقق. فشل الدفع يظهر للكاشير بدل الابتلاع الصامت. مُتحقَّق حيًّا (كود وهمي 400، X22 → 1.8 بالضبط، used_count لا يتغير بالمعاينة)
- [x] ✅ **إزالة الخصم اليدوي من POS — يوليو 9, 2026** (بطلب صريح من المستخدم، راجع STATUS.md §77): بقي الكوبون فقط بالسلة. حقل `discount` العام بالباك إند لم يُمَس (مستخدَم بتدفق الطاولات/dine-in)

### 10H — الموارد البشرية ✅ مكتمل — July 3, 2026
- [x] حضور وغياب — `POST /attendance/check-in`/`check-out` (سجل واحد مفتوح لكل مستخدم، محمي بـunique index بمستوى قاعدة البيانات + منطق بمستوى الخدمة)، `GET /attendance/me` (سجل خاص، متاح لكل الأدوار)، `GET /attendance` (الكل، صلاحية جديدة `attendance.view.all` لـowner/manager فقط)
- [x] جدولة الموظفين — CRUD كامل لـ`work_schedules` (تاريخ + وقت بداية/نهاية لكل موظف/فرع)، صلاحية جديدة `hr.manage` (owner/manager فقط)، تحقق أمني: `user_id`/`branch_id` يجب أن يخصّا نفس المستأجر (نفس نمط تحقق المستودع بـ§64) — اختُبر: محاولة جدولة لمستخدم مستأجر آخر → 400
- [x] عمولات مبيعات للموظفين — `users.commission_rate` (كسر 0-1، نفس اصطلاح `tax_rate`، اختياري/`null` افتراضيًا = لا عمولة)، قابل للتعديل عبر `PATCH /users/:id` الموجود، ومربوط بتقرير الموظفين (`GET /reports/employees` من 10I) بحقلي `commission_rate`/`commission_earned` — اختُبر: حساب العمولة مطابق تمامًا (2,876,081.52 × 0.05 = 143,804.08)
- اختُبرت كل السيناريوهات فعليًا: دورة حضور/انصراف كاملة (رفض check-in مزدوج 400، رفض check-out بلا سجل مفتوح 404)، تطبيق الصلاحيات (403 لدور cashier على endpoints الإدارية)، رفض مرجع عابر للمستأجرين
- **ملاحظة تشغيلية مهمة**: أثناء الاختبار، صلاحيات owner الجديدة (`hr.manage`/`attendance.view.all`) ظهرت مرفوضة رغم صحة السجل بقاعدة البيانات — السبب: cache صلاحيات بـRedis (`permissions:role:*`, مدة 10 دقائق) **يبقى محفوظًا عبر إعادة تشغيل السيرفر** (لأنه بـRedis منفصل لا بذاكرة العملية) من تشغيل سابق قبل إضافة الصلاحيات الجديدة — الحل: تفريغ المفاتيح يدويًا (`redis-cli DEL permissions:role:*`) بعد أي `npm run seed:permissions` أثناء التطوير المحلي
- [x] ✅ **تصحيح — يوليو 8, 2026 (راجع STATUS.md §72)**: البند التالي كان خاطئًا: ~~"لا واجهة frontend بعد لأي من الثلاثة"~~. الواجهة **مبنية ومنشورة بالكامل فعليًا** (5-8 يوليو، عشرات الـcommits) — تتضمّن أيضًا توسّعًا كبيرًا غير مخطَّط أصلًا بهذا الملف: Payroll (migration 046)، Geofencing (migration 046)، Shift Patterns القابلة لإعادة الاستخدام (migrations 049-050)، Leave Requests (migration 053)، Employee Creation Wizard، Employee Profile (4 تبويبات)، لوحة اعتماد إجازات، تطبيق حضور محمول (3 شاشات). مسجَّلة بالسايدبار (`/dashboard/employees`, `/dashboard/attendance`, `/dashboard/schedules`, `/dashboard/payroll`, `/dashboard/leaves`). لم يُوثَّق بهذا الملف وقتها — اكتُشف بفحص مباشر للكود لاحقًا

### 10I — التقارير المتقدمة ✅ مكتمل — July 3, 2026
- [x] تقارير مبيعات حسب طريقة الدفع — كانت مبنية فعليًا بتقرير `/reports/revenue` (`by_payment_method` ديناميكي منذ 10B)، لكن اكتُشف باغ حقيقي بتقرير `/reports/payments` المنفصل: كان يتعرّف فقط على `'cash'/'card'/'split'` حرفيًا، فتُستبعَد طلبات mada/visa/mastercard/stc_pay/apple_pay/tab من كل الحاويات (لكنها تبقى بـ`grand_total`). أُصلح: تجميع card-network (card/mada/visa/mastercard) وwallet (wallet/stc_pay/apple_pay) بحاويات صحيحة + إضافة `by_method` بتفصيل كل قيمة فعلية
- [x] تقارير المخزون — `GET /reports/inventory` (جديد) — قيمة إجمالية + عدد نواقص/نفاد + أعلى 10 أصناف قيمة، بإعادة استخدام `fn_inventory_stock_levels_enriched` الموجودة
- [x] تقارير الموظفين — `GET /reports/employees` (جديد) — أداء كل كاشير (عدد طلبات/إجمالي مبيعات/متوسط الفاتورة)
- [x] تقارير العملاء — `GET /reports/customers` (جديد) — ترتيب العملاء حسب الإنفاق
- [x] تقارير ضريبية — `GET /reports/tax` (جديد) — ملخص ضريبة محصَّلة/إجمالي قبل الضريبة، بتفصيل يومي. **ملاحظة نطاق**: هذا ملخص VAT بسيط فقط وليس امتثال ZATCA الكامل (فوترة إلكترونية/QR/XML) — ذاك يبقى ضمن 10K كما هو (لم يُبنَ بعد)
- [x] تصدير Excel — أُضيف دعم `?format=excel` لكل التقارير الأربعة الجديدة (نمط مطابق للتقارير الموجودة)
- اختُبر فعليًا على سيرفر محلي: كل endpoint يرجع بيانات صحيحة + تصدير xlsx صالح (بما فيها بيانات فارغة) + 403 لدور بلا `reports.view.branch`
- Frontend: أقسام "أداء الموظفين" و"ملخص الضريبة" أُضيفت لصفحة التقارير الرئيسية؛ تقارير العملاء/المخزون موصولة على مستوى الـAPI فقط (المخزون له لوحة تحكم مخصصة بالفعل منذ §55)
- [x] ✅ **إكمال — يوليو 8, 2026**: قسمان جديدان بصفحة التقارير الرئيسية كانا مفقودين فعليًا (اكتُشفا بفحص مباشر، راجع STATUS.md §72): **أفضل العملاء** (`GET /reports/customers`، كان الـhook موجودًا لكن بلا صفحة تستدعيه — كود ميت) و**التسوية اليومية** (`GET /reports/daily-reconciliation`، لم يكن له أي أثر بالفرونت إند إطلاقًا — لا hook ولا صفحة). قسم التسوية اليومية له `SingleDatePicker` منفصل (تاريخ واحد لا فترة، مطابقًا لشكل الـendpoint) بدل نطاق التاريخ العلوي المشترك. `tsc --noEmit` نظيف، الصفحة تُبنى وتُحمَّل بلا أخطاء runtime (تحقّق عبر dev server محلي، بدون backend محلي متاح للتحقق من البيانات الفعلية — نفس نمط بقية الصفحة المطابق تمامًا لأقسام موجودة مُختبَرة سابقًا)

### 10J — Dashboard تحليلي متقدم (جزئي — backend فقط، July 3, 2026)
- [x] AOV — كان موجودًا بالفعل بـ`/reports/revenue` (`avg_order_value`)؛ Churn — `GET /reports/customer-churn` (جديد): عملاء اشتروا بالفترة السابقة لكن لا بالحالية + نسبة churn. "Conversion" لم يُبنَ — لا يوجد تتبّع زوار/عملاء محتملين (leads/traffic) بالمشروع أصلًا لحساب معدّل تحويل حقيقي عليه (مقاس SaaS كلاسيكي بلا مصدر بيانات مناظر هنا)
- [x] مقارنات فترة vs فترة — `GET /reports/comparison` (جديد): الفترة الحالية مقابل فترة سابقة بنفس الطول (إيراد/طلبات/AOV + نسبة تغيّر). نسبة التغيّر من قاعدة صفرية تُرجَع `null` (غير 0 أو Infinity) لأن النمو غير معرَّف رياضيًا بهذه الحالة
- [x] مقارنات فرع vs فرع — `GET /reports/by-branch` (جديد): تفصيل الإيراد/الطلبات/AOV لكل فرع، محمي بصلاحية `reports.view.all` (أعلى من `reports.view.branch` العادية لأنه يتخطى حدود الفرع) — اختُبر: مدير (عنده branch فقط) → 403 صح
- [ ] Drill-down تفاصيل — لم يُبنَ (ميزة UX تفاعلية بالفرونت إند بالأساس، تحتاج تصميم واجهة مخصص)
- اختُبرت كل الـendpoints فعليًا على سيرفر محلي. **لا واجهة frontend بعد** — الثلاثة API فقط حتى الآن (نفس نطاق دفعة 10I للعملاء/المخزون)

### 10K — المالية والضرائب (جزئي — July 3, 2026)
- [x] VAT إعداد per tenant — كان مكتملًا بالفعل من قبل (لم يُوسَم هنا سابقًا سهوًا): `tenants.tax_rate` قابل للتعديل من كل مستأجر عبر `PATCH /tenant/profile` (راجع 10L/§58)، ويُطبَّق فعليًا بكل فاتورة POS
- [x] عملات متعددة — كان مكتملًا بالفعل من قبل (نفس الملاحظة): `tenants.currency_code`/`currency_symbol` قابلان للاختيار من 8 عملات بصفحة الإعدادات (SAR/USD/EUR/AED/KWD/BHD/QAR/OMR) — **ملاحظة نطاق**: هذا يعني كل مستأجر يعمل بعملة واحدة يختارها، **ليس** دعم تعدد عملات داخل نفس الفاتورة/المستأجر (تحويل عملات لحظي) — لم يُطلَب هذا النطاق الأوسع أصلًا
- [x] تسوية يومية — `GET /reports/daily-reconciliation?date=YYYY-MM-DD` (جديد): يجمّع مبيعات اليوم (حسب طريقة الدفع) + مصروفات معتمدة + أرقام كاش الشيفتات المغلقة (يُعيد استخدام `expected_cash`/`discrepancy` المحسوبة بالفعل بشكل صحيح لكل شيفت بدل إعادة حساب منطق الكاش من الصفر). اختُبر فعليًا بيومين مختلفين ببيانات حقيقية — الأرقام مطابقة تمامًا
- [ ] ZATCA فوترة إلكترونية — لم يُبنَ (مؤجَّل عمدًا، نطاق كبير مستقل: توقيع رقمي/XML/QR/تكامل هيئة الزكاة والضريبة — يبقى بند منفصل تمامًا عن `/reports/tax` البسيط المبني بـ10I)

### 10L — إعدادات المالك ✅ مكتمل — July 3, 2026
- [x] تخصيص الفاتورة (شعار / رقم ضريبي / تذييل) — `logo_url`/`tax_number` كانا موجودين بالجدول فعلاً لكن غير مكشوفين عبر الـ API؛ أُضيف `invoice_footer` (migration 040) وكُشفت الثلاثة عبر `PATCH /tenant/profile`
- [x] إعدادات الطابعة — `printer_settings JSONB` (paper_width 58mm/80mm، auto_print، printer_name)
- [x] إعدادات التنبيهات — `notification_preferences JSONB`، مربوطة فعليًا بـ `NotificationService.notify()` (تُسقط قناة email إن كانت معطّلة). نطاق محدود عمدًا لـ 3 أنواع فقط (`subscription_expired`/`payment_failed`/`payment_success`) — هي الوحيدة التي تُرسَل عبر email فعليًا حاليًا (تدفق dunning)؛ إشعارات expense.*/shift.*/trial_ending in-app فقط أو غير مُفعَّلة أصلاً، فلم تُعرَض كتبديل حتى لا يكون بلا أثر. اختُبر end-to-end (سكربت مباشر يستدعي `NotificationService.notify()` بقناة email+in_app، preference=false → قناة email تُسقَط فقط، preference=true → تُرسَل، نوع أمني/بدون tenant → يُرسَل دائمًا بغض النظر). Frontend: 3 أقسام جديدة بصفحة الإعدادات (تخصيص الفاتورة/الطابعة/التنبيهات). **متبقٍ**: migration 040 لم تُطبَّق على production/staging بعد (نفس ملاحظة migration 034)
- باغان حقيقيان اكتُشفا ومُصلحا أثناء الاختبار: (1) `logo_url` بـ`@IsUrl({require_tld:false})` كان يقبل نصوصًا عشوائية غير روابط فعلية (مثل "not-a-url") كـhostname صالح — أُزيلت الخيار وأصبح التحقق صارمًا (2) `@IsEnum(['58mm','80mm'])` رسالة الخطأ فارغة (خلل تنسيق cosmetic بـclass-validator عند تمرير array بدل enum حقيقي) — استُبدل بـ`@IsIn`

### 10M — إصلاح SuperAdmin Gaps ✅ مكتمل — July 3, 2026
- [x] endpoint: قائمة subscriptions للـ superadmin — `GET /superadmin/subscriptions` (فلترة status/search، joins tenant/plan name)
- [x] endpoint: إلغاء subscription — `DELETE /superadmin/subscriptions/:id/cancel`
- [x] endpoint: manual payment — `POST /superadmin/subscriptions/manual-payment` (يدعم `customAmount` مخصص بـ`BillingService.activateSubscription`)
- [x] endpoints: Auth Control للـ superadmin — tenants/options، tenant users، reset-password، change-role، toggle-active، sessions (list/revoke فردي/جماعي)
- اختُبرت كل الـendpoints فعليًا على سيرفر محلي (نجاح/400 validation/404/403 لغير superadmin/401 بلا توكن) — باغ حقيقي اكتُشف ومُصلح: `cancelSubscriptionById` كان يرجّع `success:true` حتى لو المعرف غير موجود (لا فحص count) — أُصلح ليرجع 404
- Frontend: `subscriptions.api.ts`/`useSubscriptions.ts` وُصلا بالـendpoints الحقيقية بدل الـstubs (auth-control frontend كان جاهزًا مسبقًا بنفس المسارات تمامًا)

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

## ⏸️ PHASE 14 — Smart Data Import Center (AI-assisted Import Platform) (مؤجّل عمدًا — بعد اكتمال واستقرار ERP الأساسي)

**⚠️ ليست جزءًا من مرحلة المخزون الحالية (Inventory Phase 2/3).** قسم تخطيط فقط — لا تنفيذ بعد. راجع STATUS.md §53 للتصميم الكامل والمنطق الهندسي.

موديول مستقل (`modules/imports` / Import Center) لاستيراد أي كيان (Products، Warehouses، Locations، Customers، Suppliers، إلخ) من ملفات Excel/CSV عبر **إطار مشترك** بدل شاشة استيراد مخصصة لكل كيان.

**المبدأ الأساسي: Heuristics-first** — rules + regex + قواميس مرادفات + محرك تحقق، يعمل بالكامل offline دون أي اتصال AI. **طبقة AI اختيارية فوقه** (تحسين column mapping / entity matching / data cleaning فقط) — ليست شرطًا للعمل الأساسي.

- [ ] Pipeline: Upload → Detect File → Column Mapping → Data Cleaning → Validation → Preview → Import → Report → Rollback
- [ ] Import History (سجل كل عمليات الاستيراد السابقة)
- [ ] Rollback support (تراجع كامل عن استيراد سابق)
- [ ] Entity Matching (تجنّب التكرار، تحديث بدل إنشاء عند التطابق)
- [ ] Validation Engine (عام، قابل لإعادة الاستخدام بين كل الكيانات)
- [ ] Import Preview (معاينة قبل التنفيذ الفعلي)
- [ ] Import Report (تقرير تفصيلي بعد كل استيراد)

**⚠️ مبدأ معماري إلزامي (مُضاف يونيو 29, 2026)**: الموديول **entity-agnostic و provider-agnostic** إلزاميًا:
- لا يُربَط بمنطق خاص بأي كيان محدد (Products/Warehouses/Customers...) — كل كيان يُسجَّل كـ"importer" بتعريف schema/mapping خاص به فوق framework مشترك، دون تعديل الـcore.
- طبقة AI الاختيارية خلف abstraction عام (provider-agnostic) — لا اعتماد مباشر على Claude/OpenAI/Gemini داخل الـpipeline؛ يمكن إضافة/استبدال/تعطيل أي مزوّد دون تغيير الـpipeline.
- مصادر الاستيراد قابلة للتوسّع منذ التصميم الأول وراء adapter موحَّد، حتى لو بدأت Phase 14 بـExcel/CSV فقط: Google Sheets، JSON، XML، REST APIs، Shopify، WooCommerce، Odoo، SAP، أدوات ترحيل ERP أخرى.
- التفاصيل الكاملة بـSTATUS.md §53 (قسم "ملاحظة معمارية إضافية").

**لماذا مؤجَّلة**: تعتمد على schemas/business-rules ناضجة ومستقرة لكل الكيانات المستهدفة. تُبنى فقط بعد اكتمال واستقرار موديولات ERP الأساسية (المخزون، المشتريات، نقاط البيع، العملاء، الفواتير)، تجنّبًا لإعادة العمل المتكررة على أساس متحرك. التصميم المعماري الكامل (موديول/heuristics/AI اختياري/pipeline التفصيلي) موثَّق بـSTATUS.md §53 ولا يُكرَّر هنا.

---

## ⏸️ PHASE 15 — Storage Infrastructure & Abstraction (مؤجّل عمدًا — حتى اكتمال الموديولات الأساسية)

**⚠️ ليست جزءًا من مرحلة المخزون الحالية (Inventory Phase 2/3) ومستقلة عن PHASE 14.** قسم تخطيط فقط — لا تنفيذ بعد. راجع STATUS.md §56 للتصميم الكامل والمنطق الهندسي.

طبقة تخزين عامة (`core/storage`) تجعل المشروع كاملًا مستقلًا عن مزوّد التخزين — منطق الأعمال لا يعتمد مباشرة على Supabase Storage أو أي مزوّد آخر.

- [ ] `StorageProvider` (interface) + `StorageService` + `StorageModule`
- [ ] تنفيذ مزوّد Supabase Storage (أول مزوّد فعلي)
- [ ] تنفيذ مزوّدين مستقبليين خلف نفس الواجهة: AWS S3، Cloudflare R2، MinIO، Azure Blob، Local Storage (اختياري)
- [ ] دوال الواجهة: `upload()` / `download()` / `delete()` / `exists()` / `move()` / `copy()` / `createSignedUrl()` / `getPublicUrl()`
- [ ] اختيار المزوّد عبر `STORAGE_DRIVER` (env var) — بلا تعديل كود عند التبديل
- [ ] مخطط DB لمراجع مستقلة عن المزوّد (`bucket` / `path` / `storage_key`) — بلا تخزين أي رابط خاص بمزوّد
- [ ] استراتيجية ترحيل بدون توقف خدمة: dual storage mode، background migration jobs، verification، automatic fallback، progressive migration، final cutover

**نطاق التغطية المستهدف (لاحقًا، عند التنفيذ)**: صور المنتجات/العملاء/الموردين، شعارات الشركة، المرفقات، المستندات، العقود، مستندات الشراء/المبيعات/المخزون، التقارير، تصدير PDF، ملفات Import Center (PHASE 14)، النسخ الاحتياطي، وأي نوع ملف مستقبلي — كل ذلك عبر `StorageService` فقط.

**لماذا مؤجَّلة**: بناء طبقة تخزين عامة قبل استقرار الموديولات الأساسية يعني تصميمها على أساس متحرك. تُنفَّذ بعد اكتمال واستقرار ERP الأساسي، كاستثمار بنية تحتية (foundational infrastructure) يمكّن التوسّع المستقبلي والاستقلالية عن المزوّد. التصميم الكامل موثَّق بـSTATUS.md §56 ولا يُكرَّر هنا.

---

## 🔒 SAFETY & SCALE INITIATIVE — PHASE 1: ENTERPRISE TENANT ISOLATION & SAFETY CORE
**Parallel/cross-cutting track — not sequential to PHASE 1–15 above.** Named "PHASE 1" of its own
initiative per explicit user request; do not confuse with the already-complete original Phase 1.
Full technical spec: [`HIGH_SCALE_ARCHITECTURE.md`](../HIGH_SCALE_ARCHITECTURE.md) §2–§3.
Execution tracking: [`ENGINEERING_ROADMAP.md`](../ENGINEERING_ROADMAP.md) Phase 1.
Started: July 10, 2026.

- [ ] Implement Tenant Context Injection via PostgreSQL `SET LOCAL app.tenant_id`
  - **Cannot be attached to `api/src/shared/supabase/supabase.module.ts`** — that module wraps `@supabase/supabase-js`, which talks to PostgREST over stateless HTTP. `SET LOCAL` requires a session/transaction pinned to one physical connection, which PostgREST calls don't provide. Implemented instead as new infrastructure: `api/src/shared/database/pg-pool.module.ts` (raw `pg.Pool`, Supavisor transaction mode) + `api/src/core/tenant/tenant-session.service.ts` (`runInTenantContext` wrapper).
  - Requires a new env var not currently in `.env.example`: `DATABASE_URL` (Supavisor transaction-mode pooler connection string) — **manual provisioning step**: obtain from Supabase dashboard → Settings → Database → Connection Pooling, add to Railway env vars.
- [x] ~~Refactor `api/src/shared/supabase/supabase.module.ts` to manage pooled session context~~ — **not applicable to this module** (see above); pooled session context lives in the new `pg-pool.module.ts` / `tenant-session.service.ts` instead. `supabase.module.ts` is unchanged and continues serving the ~90% of endpoints that don't need transaction-scoped RLS.
- [x] Migrate hot-path repositories to the pg.Pool + `TenantSessionService` (`InvoicesRepository` ✅, `StockRepository` ✅, `LoyaltyService`'s customer-balance path ✅) — all three named targets done. `core/tenant/scoped.repository.ts` (PostgREST-based) was **not** converted to fake session context; it remains the mechanism for repositories that stay on Supabase-JS, with `.eq('tenant_id', ...)` as documented defense-in-depth, not primary enforcement, for those paths.
- [x] Audit `LoyaltyService.getBalance`/`redeemPoints` cross-tenant vulnerability — **verified already fixed and still intact** (`assertCustomerInTenant` called in `awardPoints`/`redeemPoints`; `getBalance` filters `.eq('tenant_id', tenantId)` directly). Original fix per `STATUS.md` §(loyalty leak). Added as a permanent regression test instead of re-fixing: `api/test/tenant-isolation.e2e-spec.ts` (pending).
- [x] **Broader finding beyond the original ask, now fully audited**: 22 of 45 repository files do not extend `core/tenant/scoped.repository.ts`. All 22 now checked (5 previously spot-checked + 17 in this pass) — see `STATUS.md` §83 for the full per-file verdict list. **One confirmed, fixed vulnerability found and patched in this pass** (privilege escalation, not a repository-filtering gap — see below).
- [x] Generate and execute DB migrations for `CREATE POLICY` (RLS) — **scope correction confirmed precisely this pass**: 65 distinct tables total (`CREATE TABLE` count), of which **46 have `ENABLE ROW LEVEL SECURITY`** (not all 65 — the other 19 never had RLS turned on at all, a separate, smaller gap noted below). Of those 46: 10 already had `CREATE POLICY` before this session (`075`/`076` + pre-existing `005`/`073`/`074`); **all 33 of the remaining 36 now have policies**, written across 5 new migrations (`077`–`081`) grouped by domain, verified table-by-table against actual schema (not assumed) — see `STATUS.md` §84. **3 tables deliberately excluded, not missed**: `domain_events_outbox` (genuinely cross-tenant background infra — a tenant-scoped policy would break the outbox relay), `features`/`plan_features` (global catalogs, no `tenant_id` column at all). **Not yet applied to any environment** — same `DATABASE_URL` + dedicated-role blocker as `075`/`076`.
- [x] **19 never-RLS-enabled tables — audited, classified, and closed (July 10, 2026)**. Full per-table purpose + classification in `STATUS.md` §85. Verified before writing any SQL: none of the 19 are in the `supabase_realtime` publication (only `tables`/`orders`/`order_items` are), and nothing in the codebase queries them outside `SUPABASE_SERVICE_ROLE_KEY` — so enabling RLS on them has zero observable effect today, same as the original `001_initial_schema.sql` rollout. 4 new migrations (`082`–`085`), `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` bundled together per table (not split across two steps, unlike 075-081's older already-enabled tables): 15 tables policied, 4 (`permissions`, `permission_groups`, `role_permissions`, `plans`) explicitly excluded and documented — global catalogs, no `tenant_id` column at all. `roles` needed a dual-condition policy (`tenant_id IS NULL OR tenant_id = current_setting(...)`) — it holds both system roles (tenant_id NULL) and tenant-custom roles, mirroring the exact check `AccessControlService.getAccessibleRoleOrThrow()` already does in code. Verified via automated diff: all 19 original names accounted for, zero typos, zero gaps. **Still not applied to any environment** — same `DATABASE_URL` + dedicated-role blocker as everything else in this initiative.
- [x] Rollback snapshot taken before any further hot-path refactor — `_backup_before_rls_refactor/` at repo root: `api/src/shared/supabase/supabase.module.ts`, `api/src/core/tenant/scoped.repository.ts`, all of `api/src/modules/invoices/**`, all of `api/src/engines/pos-engine/**`. No git repo exists in this workspace, so this manual copy is the only rollback point today — see the folder's own `README.md`.
- [x] Findings permanently documented — `STATUS.md` §79 "CRITICAL ARCHITECTURAL WARNINGS & DISCOVERIES (JULY 2026)": (1) `@supabase/supabase-js` HTTP-stateless limitation, (2) `SUPABASE_SERVICE_ROLE_KEY` RLS-bypass risk, (3) the 22/45 repositories-not-extending-`ScopedRepository` blindspot list.
- [x] Full manual audit of the remaining 17 (of 22) blindspot repositories not yet spot-checked (July 10, 2026) — see `STATUS.md` §83. 16 of 17 confirmed either correctly tenant-scoped or legitimately exempt (infra/superadmin-only-by-design). **1 real, confirmed, exploitable vulnerability found and fixed** — see next item.
- [x] **CRITICAL — found and fixed (July 10, 2026): privilege escalation to platform-wide cross-tenant data.** Any tenant `owner` could self-grant `analytics.view.all` or `audit.view.all` to their own role via the legitimate role-customization feature (`PATCH /access-control/roles/:roleId/permissions/:permissionKey`), because `AccessControlService.assertPermissionIsCustomizable()` only blocked `resource === 'superadmin'` — these two permissions carry `resource: 'analytics'`/`'audit'`. `AnalyticsController` (`/superadmin/analytics/*` — MRR/ARR/churn/cohort/growth, all tenants) and `AuditLogsController` (`/superadmin/audit-logs` — all tenants' audit trail) were guarded only by `PermissionGuard`, not `SuperAdminGuard` — so the self-granted override was sufficient for full access. **Fixed**: added `SuperAdminGuard` to both controllers (matching the main `superadmin.controller.ts` pattern) as the real enforcement boundary, plus a hardcoded-key stopgap in `assertPermissionIsCustomizable`. `tsc --noEmit` and `nest build` clean. See `STATUS.md` §83 for full detail and the durable-fix recommendation (schema-level `is_platform_only` flag).
- [x] First hot-path refactor executed (July 10, 2026) — `InvoicesRepository.createWithItemsPooled()` (new method, atomic order+order_items insert over `TenantSessionService`) + `InvoicesService.create()` gated by `POOLED_INVOICE_WRITES_ENABLED` (default `false`, defined in `env.validation.ts`). `PgPoolModule` made non-throwing (`config.get` not `getOrThrow`) so importing it doesn't crash boot without `DATABASE_URL`; wired app-wide via new `TenantSessionModule` (`@Global`, imported once in `app.module.ts`). **`pos.engine.ts` was not modified — it holds zero DB access (pure arithmetic: `buildInvoice`/`applyTax`/`calculateTotal`), so there was nothing tenant-isolation-related to refactor there.** `tsc --noEmit` and `nest build` both clean. **Not yet enabled** — blocked on `DATABASE_URL` provisioning + migration 075 apply, per §79.
- [x] Second hot-path refactor executed (July 10, 2026) — `StockRepository.callApplyStockMovementPooled()` (new method, calls `fn_apply_stock_movement` via `TenantSessionService` instead of PostgREST `.rpc()`) + `StockService.applyStockMovement()` gated by `POOLED_STOCK_WRITES_ENABLED` (default `false`). New migration `076_rls_policies_stock_tables.sql` — `stock_levels`/`stock_movements` had `ENABLE ROW LEVEL SECURITY` since `017_inventory_ledger.sql` but zero `CREATE POLICY` until now. **Different shape from the Invoices fix**: `fn_apply_stock_movement` was already a single atomic RPC (no order+items-style split to fix) — this migration is purely about making RLS binding, not about atomicity. `inventory.module.ts`'s manual `useFactory` wiring for `StockRepository` updated to inject `TenantSessionService`. `tsc --noEmit` and `nest build` both clean. **Not yet enabled** — same `DATABASE_URL` blocker, gated on migration 076 instead of 075.
- [x] **Bug found and fixed in this same pass, unrelated to the above**: the very first `TASKS.md` edit in this initiative had accidentally deleted the `## Guard Execution Order` header (content survived, heading did not) — restored immediately upon discovery. Flagging here as a reminder to re-verify large `Edit` diffs against source, not just the intended insertion.
- [x] Third and final hot-path refactor executed (July 10, 2026) — `LoyaltyService.getBalancePooled()`/`awardPointsPooled()`/`redeemPointsPooled()`, gated by new `POOLED_LOYALTY_WRITES_ENABLED`, all three call sites in `InvoicesService.create()` branched. **This closes the initiative's hot-path migration subtask** — see `STATUS.md` §82 for a load-bearing caveat discovered while writing this one: it applies retroactively to the Invoices/Stock work too, not just Loyalty.
- [ ] **New blocking item surfaced by the Loyalty work, applies to all three pooled paths (075/076/Loyalty)**: `DATABASE_URL` must authenticate as a dedicated Postgres role with `NOBYPASSRLS` and explicit `GRANT`s — **not** Supabase's default `postgres` role (typically bypasses RLS same as `service_role`). Using the default role would make every pooled-write flag flip a no-op for isolation, silently. Role creation is a manual DB-admin step, not something this session can perform. See `STATUS.md` §82.

---

## Guard Execution Order (إلزامي — لا تغيير)
JwtAuthGuard → TenantGuard → PermissionGuard → FeatureGuard
لا تُسجّل أي guard كـ APP_GUARD قبل أن الـ guard قبله مكتمل ومختبر.

---

## مراجع
- ميزات المنتج الكاملة: FEATURES.md
- حالة المشروع: STATUS.md
- قرارات المعمارية: DECISIONS.md

---

## 🔒 Inventory/WMS Workstream Checkpoint — 2026-08-08 (راجع STATUS.md، القسم بنفس العنوان)

~~Inventory/WMS مقفلة كمكتملة~~ — **تصحيح (راجع قسم CORRECTION بـSTATUS.md بنفس التاريخ): Inventory/WMS ليست مكتملة، بل IN PROGRESS / PAUSED / DEPENDENCY BLOCKED.** كل ما نُفِّذ (24-point roadmap items #1, #6, #7, #10, #12–19 — الأساسيات، WMS، Receiving، Putaway، Picking/Packing/Shipping، Transfers، Reservations، Costing foundations، Batch/Serial/FEFO، Counts/Adjustments، Replenishment/MRP foundations، تكامل Sales/Purchasing/Manufacturing/Quality/Scanner) **مُختبَر ومستقر (348/348)** لكنه ليس النطاق النهائي الكامل — الجزء المتبقي (ترحيل تكلفة المخزون/COGS/محاسبة المشتريات والمبيعات والتصنيع/landed-cost/الترحيل المالي لحركات المخزون) يعتمد على **Accounting Core** (Advanced Accounting & Financial Management من الـMaster Plan نفسه، PLANNED_NOT_STARTED حاليًا).

**ترتيب التنفيذ الحالي:** Inventory/WMS (متوقفة عند هذا الـcheckpoint المُتحقَّق) → Accounting Core → استئناف Inventory/WMS → إكمال التكامل المتبقي → checkpoint إنهاء نهائي لـInventory/WMS → استكمال باقي خارطة Core.

Universal Device Platform (#21) لا تزال مكتملة حتى Phase 7 + Authorization Patch، ومجمَّدة كبنية تحتية backend فقط — **ممنوع البدء بـPhase 8 (Mobile Scanner App)**. آخر migration: `175_scanner_resolver_rfid_and_entity_types.sql`. آخر تحقق: 348/348 اختبار ناجح — نقطة الاستئناف بالضبط عند هذا الرقم.

**ممنوع حاليًا:** بدء تنفيذ Accounting، أي migration جديدة، UOM، Notification Center، Approval Workflow، HR، CRM، أو أي تطبيق مستقل — حتى موافقة صريحة منفصلة على بدء Accounting Core تحت بروتوكول Execution Gate القائم. تطوير Web Frontend الحالي يستمر بشكل طبيعي دون تأثر.

---

## 🏗️ PHASE 16 — Sefay Global Financial Platform (بدأ التنفيذ، 2026-08-09)

بعد سلسلة مراجعات معمارية كاملة (Domain Audit → Coexistence Gate → Database Spec → Schema Integrity Review → Pre-Migration Clarification → Pre-Implementation Fix Gate) والموافقة الحرفية "Approved – Proceed with Implementation"، بدأ تنفيذ سلسلة Migration M176–M189.

**✅ M176 — Foundation & Reference Catalogs (مُطبَّقة)**: `176_accounting_foundation_reference_catalogs.sql` — تفعيل `btree_gist` + إنشاء `accounting_owner_types` و`financial_event_source_types` (جداول **عالمية**، بلا `tenant_id`، بلا RLS، عن قصد — لا تحتوي بيانات خاصة بأي مستأجر). التحقق الكامل: تحقّق مباشر من البيانات المزروعة، idempotency مؤكَّدة، tsc/build نظيفة، 348/348 اختبار ناجح (بدون انحدار)، إقلاع التطبيق ناجح. لا تعديل على أي جدول موجود، لا لمس لـInventory/WMS. راجع STATUS.md لتفاصيل التحقق الكاملة.

**✅ M177 — Companies (مُطبَّقة، 2026-08-09)**: `177_accounting_companies.sql` — جدول `companies` فقط (بدون عمود fiscal-calendar/COA، بالضبط كما اعتُمد بـFinal Pre-Implementation Fix Gate)، مع backfill شركة افتراضية واحدة لكل مستأجر نشط (تحقّق مباشر: 15 مستأجر ← 15 شركة، بلا نقص وبلا تكرار). 348/348 اختبار ناجح (فشل عابر واحد غير مرتبط في `wms-13.20` نجح عند إعادة التشغيل — تذبذب شبكي معروف مسبقًا هذه الجلسة). راجع STATUS.md للتفاصيل.

**✅ M178 — Accounting Owners (مُطبَّقة، 2026-08-09)**: `178_accounting_owners.sql` — إضافة `UNIQUE(tenant_id,id)` على `branches` و`companies` (أول استخدام لهذا النمط بالمشروع)، ثم إنشاء `accounting_owners` بـFK مركّبة آمنة tenant-safe (لا polymorphic ownership). **الاختبار الحرج مُثبَت فعليًا ضد قاعدة البيانات الحقيقية**: محاولة ربط Accounting Owner لمستأجر A بشركة/فرع مستأجر B مرفوضة بخطأ Postgres `23503` على مستوى الـFK نفسه، وليس فقط RLS. Central Owner (`branch_id=NULL`) يعمل بنجاح. 348/348 اختبار ناجح، لا انحدار. راجع STATUS.md للتفاصيل الكاملة.

**✅ M179 — Branch Accounting Assignment History (مُطبَّقة، 2026-08-09)**: `179_branch_accounting_assignments.sql` — العلاقة effective-dated الحرجة (Branch→Accounting Owner عبر الزمن)، بـexclusion constraint (`btree_gist`) يمنع أي تداخل فعليًا على مستوى قاعدة البيانات. **اختُبر المثال الكامل من التصميم المعتمد فعليًا**: Branch 127 → Owner A (2026-2031) → Central Owner (2031-2033، تلامس الحدود بلا تداخل) → Owner A مجددًا (2033-مفتوح) — الثلاث فترات أُدرجت بنجاح، والاستعلام التاريخي لكل سنة يرجع المالك الصحيح لتلك الفترة بالضبط. رُفض: التداخل، فترة "مفتوحة" ثانية لنفس الفرع، تواريخ غير منطقية، DELETE على سجل تاريخي، تعديل أي عمود على سجل مُغلَق. المسموح الوحيد: إغلاق `effective_to` لسجل مفتوح حاليًا، مرة واحدة فقط. 348/348 اختبار ناجح (فشل عابر واحد غير مرتبط في `manufacturing-locations` نجح عند إعادة التشغيل — نفس نمط التذبذب الشبكي المعروف). راجع STATUS.md للتفاصيل الكاملة.

**⚠️ تصحيح — رفض كيان Company وTRACK BACK كامل لـM177–M179 (2026-08-10)**: قرار معماري نهائي من مالك النظام: **Tenant = Company** — لا يوجد ولن يوجد كيان Company منفصل بسيفاي؛ Tenant هو الهوية القانونية/التجارية الوحيدة المعتمدة (بحقوله الحالية `name`/`tax_number`/`currency`). بعد سلسلة تدقيقات (Company Entity Audit ← Forward-Fix Audit ← Migration Rebuild Audit) تبيّن أن migration runner (`migrate.ts`) يتتبّع الملفات بالاسم فقط بلا checksum وبلا آلية rollback، فإعادة كتابة M177/M178 في مكانهما غير آمنة (ستُحدث تعارضًا لأي بيئة جديدة). **التنفيذ الفعلي، بموافقة صريحة "Approved – Proceed with Implementation"**: حذف كامل من قاعدة البيانات الحية (DDL مباشر، ليس migration جديدة) لجداول `branch_accounting_assignments` و`accounting_owners` و`companies` بكل قيودها وindexes وRLS وtriggers/functions، وقيد `uq_branches_tenant_id` المُضاف على `branches`، وسجلات schema_migrations لـ177/178/179. تحقّق فحص Dependencies أولًا (صفر FK خارجية)، ثم تحقّق بعد الحذف: الجداول الثلاثة غائبة تمامًا، `branches` سليمة (22 سجل)، M176 سليمة تمامًا (`accounting_owner_types` بأربع قيمها المزروعة، `financial_event_source_types` موجودة)، `schema_migrations` ينتهي عند 176 بلا أي أثر لـ177/178/179. **ملفات الـmigration 177–179 نفسها لم تُحذف** (سجل تاريخي دائم حسب سياسة append-only)، لكن لا يجوز إعادة تطبيقها كما هي — الأساس الصحيح لـAccounting سيُبنى كـmigration جديدة (بترقيم يبدأ من M177 من جديد) بعد تصميم منفصل واعتماد صريح. قاعدة البيانات الآن فعليًا بحالة ما بعد M176. لم يُنشأ M180. Inventory/WMS بلا تغيير.

**✅ إعادة بناء M177 — Accounting Owner (مُطبَّقة، 2026-08-10)**: بعد اعتماد التصميم النهائي المصحح (Book≠Ledger، Fiscal Calendar مُرقَّمة بالإصدارات، Posting Function للتكامل الذري، Accounts بلا COA منفصلة، Dimensions مؤجَّلة بأمان) والموافقة الصريحة "Approved – Proceed with M177"، أُعيد بناء M177 من الصفر. **اكتشاف ميكانيكي قبل التنفيذ**: ملفات M177/M178/M179 القديمة (المرفوضة) ما زالت على القرص وغير مُسجَّلة كمطبَّقة، وكانت ستُطبَّق تلقائيًا مجددًا عند أي `npm run migrate`. **تم الحل بموافقة منفصلة**: إعادة تسمية الملفات الثلاثة بامتداد `.superseded` (بلا حذف أو تعديل للمحتوى) لمنع الـrunner من التقاطها. أُنشئت `177_accounting_owners.sql` الجديدة: `accounting_owners(tenant_id NOT NULL, branch_id NULLABLE, owner_type_code, name, status)` — **بلا companies وبلا company_id إطلاقًا** — `tenant_id` هو المرجع الوحيد للملكية. Central Accounting عبر `branch_id = NULL` بلا Branch وهمي. تحقّق كامل: FK رفض عبر-المستأجرين (`23503`)، تفرّد الفرع الواحد لكل مالك (`23505`)، Central owner متعدد مسموح، RLS مطابق للنمط القياسي، idempotency مؤكَّدة، tsc/build نظيفة. Regression: تشغيلان كاملان أظهرا فشلًا عابرًا مختلفًا في كل مرة (`wms-13.20` ثم `purchasing/agreements`)، كلاهما نجح 100% عند العزل — نفس نمط التذبذب المعروف مسبقًا. **التشغيل الثالث: 348/348 ناجح بالكامل.** لم يُنشأ M178 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M178 — Branch Accounting Assignment History (مُطبَّقة، 2026-08-10)**: نفس التصميم المُثبَت سابقًا (لم يعتمد على Company إطلاقًا)، بترقيم جديد ومرجع FK لـM177 المُعاد بناؤها. `branch_accounting_assignments` بـFKs مركّبة آمنة، exclusion constraint يمنع التداخل (`btree_gist`)، ومنطق immutability (DELETE ممنوع دائمًا، UPDATE ممنوع إلا لإغلاق `effective_to` لسجل مفتوح مرة واحدة). **تحقّق كامل على قاعدة بيانات حية**: رفض عبر-المستأجرين (`23503` للفرع وللمالك)، المثال الثلاثي الكامل (Owner A ← 2026-2031 ← Central 2031-2033 (تلامس حدود) ← Owner A 2033-مفتوح) نجح بالكامل، رفض التداخل (`23P01`)، رفض فترة مفتوحة ثانية (`23P01`)، رفض تواريخ غير منطقية (`23514`)، الاستعلام التاريخي لـ2027/2032/2035 يرجع المالك الصحيح لكل فترة، كل حالات حارس التعديل (DELETE/UPDATE على سجل مغلق مرفوضة، الإغلاق المسموح مرة واحدة يعمل، إعادة الإغلاق مرفوضة)، RLS مطابقة. tsc/build نظيفة. **Regression: 348/348 ناجح من أول تشغيل، بلا أي تذبذب هذه المرة.** Idempotency مؤكَّدة. لم يُنشأ M179 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M179 — Fiscal Calendar + Fiscal Year + Fiscal Period (مُطبَّقة، 2026-08-10)**: `fiscal_calendars` (مُرقَّمة بالإصدارات، effective-dated، نفس آلية M178) + `fiscal_years`/`fiscal_periods` كـ**حقائق مولَّدة وغير قابلة للتغيير** عبر `fn_generate_fiscal_year()` التي تقرأ إعداد التقويم مرة واحدة فقط عند التوليد وتكتب التواريخ الفعلية بشكل دائم — لا يُعاد اشتقاقها من التقويم أبدًا لاحقًا. **الاختبار الجوهري (تغيير السنة المالية)**: تقويم A (يبدأ يناير) وَلَّد FY2026/FY2027، ثم أُغلق وأُدخل تقويم B (يبدأ أبريل) لِـ2028 فصاعدًا — **FY2026 بقيت 2026-01-01→2027-01-01 دون أي تغيير** بعد إدخال التقويم الجديد، مما يثبت أن التقويم الحالي لا يعيد تفسير السنوات التاريخية. تحقّق كامل: رفض عبر-المستأجرين، رفض إعادة توليد نفس السنة (`23505`)، رفض تداخل التقويمات والسنوات (`23P01`)، حماية الفترات، immutability للتواريخ مع سماح تغيير `status` فقط، فحص تواريخ منطقي (`23514`)، الاستعلام التاريخي لـ2027-06-15 يرجع الفترة الصحيحة حتى بعد تغيير التقويم، RLS مطابقة. tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. لم يُنشأ M180 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M180 — Accounting Book (مُطبَّقة، 2026-08-10)**: `accounting_books(tenant_id, accounting_owner_id, book_type IN ('primary','management','statutory','adjustment'), name, is_default, status)` بـFK مركّبة آمنة، وقيد `is_default=false OR book_type='primary'`، وتفرّد Book افتراضي واحد لكل Owner، وتفرّد نوع واحد لكل Owner حاليًا. **ضمان تلقائي على مستوى قاعدة البيانات**: trigger جديد على `accounting_owners` يُنشئ تلقائيًا Book افتراضي Primary لحظة إنشاء أي Accounting Owner (فرعي أو مركزي) — لا يعتمد على تطبيق التطبيق. تحقّق كامل: الإنشاء التلقائي يعمل لمالك فرعي ومالك مركزي، رفض عبر-المستأجرين (`23503`)، رفض تكرار الافتراضي (`23505`)، رفض تكرار النوع (`23505`)، رفض جعل كتاب غير Primary افتراضيًا (`23514`)، نجاح إنشاء كتب Statutory وAdjustment بلا أي تعديل بالمخطط — يثبت أن الأنواع المستقبلية إضافية فقط. عزل الملكية صحيح، RLS مطابقة. tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. لم يُنشأ M181 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M181 — Accounts (مُطبَّقة، 2026-08-10)**: جدول `accounts` هو Chart of Accounts نفسه — بلا جدول `chart_of_accounts` منفصل. Tenant-scoped بالكامل (COA واحدة لكل Tenant)، hierarchy عبر `parent_account_id` بـFK ذاتية آمنة tenant-safe، `account_type`/`normal_balance`/`is_posting_account`/`is_system_account`/`is_active`. **حارس واحد على مستوى قاعدة البيانات (trigger)** يمنع: الحذف نهائيًا لأي حساب (التعطيل هو المسار الوحيد)، تعديل الحقول المحمية أو تعطيل الحسابات النظامية، أن يكون الحساب الأب نفسه Posting Account، **الدورات الهرمية (Cycle) عبر تتبّع سلسلة الآباء فعليًا**، وتعليم حساب له أبناء كـPosting Account. **تحقّق كامل بـ14 سيناريو، كلها ناجحة**: إنشاء أب/ابن، تفرّد الكود داخل Tenant (`23505`)، سماح نفس الكود عبر مستأجرين مختلفين، رفض الأب عبر-المستأجرين (`23503`)، رفض الحساب كأب لنفسه، رفض التفرّع تحت حساب Posting، **رفض دورة A→B→A فعليًا**، رفض تعليم حساب له أبناء كـPosting، حماية الحسابات النظامية (رفض تعديل الكود ورفض التعطيل)، السماح بتعطيل حساب عادي، رفض الحذف نهائيًا (حتى للحسابات النظامية)، RLS مطابقة، فحص CHECK للقيم الصحيحة. tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. لم يُنشأ M182 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M182 — Journal Entry + Journal Lines + Posting Engine (مُطبَّقة، 2026-08-10)**: `journal_entries`/`journal_lines` بـFKs مركّبة آمنة إلى Book/Period/Accounts وكتالوج M176. **محرك الترحيل على مستوى قاعدة البيانات**: `fn_post_journal_entry()` (SECURITY DEFINER) هو المسار الوحيد المسموح لحالة Posted — يقفل السجل (`FOR UPDATE`) لحماية التزامن، يتحقق من توازن Debit/Credit، صحة الحسابات (نشطة وPosting)، نشاط الـBook، وأن الفترة المالية مفتوحة — ثم يُفعّل التحويل عبر GUC flag تفرضه الـtrigger. `fn_reverse_journal_entry()` ينشئ قيد عكسي بمبادلة Debit/Credit ويُرحّله عبر نفس المحرك، ثم يُعلّم الأصلي كـReversed. Triggers تمنع أي تجاوز مباشر (تعديل status يدويًا مرفوض)، وتُجمّد القيود المُرحَّلة بالكامل (Header وLines معًا). **تحقّق بـ17 سيناريو + اختبار تزامن حقيقي منفصل، كلها ناجحة**: تعديل Draft حر، رفض أقل من سطرين، رفض عدم التوازن، رفض المبالغ الصفرية/السالبة/ثنائية الجانب، رفض حساب Header أو معطّل، رفض الترحيل في فترة مغلقة، رفض عبر-المستأجرين (Book وAccount)، رفض Book غير نشط، **نجاح الترحيل الصحيح**، **رفض التجاوز المباشر لحالة Posted**، **تجميد كامل للقيد المُرحَّل (Header+Lines، تعديل وحذف وإضافة)**، رفض الترحيل المزدوج التسلسلي، **اختبار تزامن حقيقي (Promise.allSettled متزامن): نجح واحد فقط من محاولتين متزامنتين، بلا أي فساد بيانات**، **Reversal ناجح مع مبادلة Debit/Credit صحيحة**، رفض إعادة العكس المزدوج، السماح بحذف Draft فقط، RLS مطابقة. tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. لم يُنشأ M183 أو أي migration بعدها. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**🏁 حالة Accounting Foundation**: بإتمام M182، السلسلة الأساسية الكاملة المعتمدة عبر جولات المراجعة المعمارية لهذه الجلسة أصبحت مُطبَّقة ومُتحقَّقة بالكامل من طرف إلى طرف: Tenant(=Company) → Branch → Accounting Owner → Branch Assignment History → Fiscal Calendar/Year/Period → Accounting Book → Accounts → Journal Entry/Lines. أي قدرة مستقبلية (AR/AP، ضرائب، محاسبة المخزون، Dimensions، توحيد الحسابات) إضافية فوق هذه السلسلة دون الحاجة لإعادة النظر في الأساس. الخطوة التالية تتطلب قرارًا بشريًا صريحًا منفصلًا.

**📋 Accounting Integration Audit (2026-08-10)**: تدقيق كامل (بلا تنفيذ) عبر Sales/Purchasing/Inventory/Payments/Tax/AR/AP باستخدام المستودع الفعلي كمرجع. أهم اكتشاف: جدول `payments` الحالي هو آلية فوترة SaaS الخاصة بسيفاي (مرتبط بـ`invoices` الفوترة، stripe/moyasar/tap) — **ليس** دفتر دفعات عملاء/موردين، ولا يوجد مثل هذا الدفتر إطلاقًا حاليًا (فجوة حقيقية موثّقة، وليست شيئًا يُعاد استخدامه). كتالوج `financial_event_source_types` من M176 يغطي بالفعل sales/purchasing/inventory/manufacturing/expenses دون أي حاجة لتعديل. AR/AP تقرّر أنهما Control Accounts محاسبية تشير إلى customers/suppliers/orders/goods_receipts الموجودة فعليًا — لا فواتير محاسبية مكرّرة. الترتيب المقترح: M183 (Account Role Assignments) ← Sales ← Purchasing ← Inventory ← Payments (جدول جديد مطلوب) ← Tax (فقط إذا تأكدت حاجة VAT حقيقية).

**✅ M183 — Account Role Assignments (مُطبَّقة، 2026-08-10)**: `account_roles` كتالوج عالمي (نفس نمط M176) بـ8 أدوار مزروعة (sales_revenue, inventory_asset, cogs, accounts_receivable, accounts_payable, tax_payable, default_cash, default_bank) + `account_role_assignments` (tenant-scoped) بـFK مركّبة آمنة لـaccounts، وFK عادية لـrole_code (دور غير معرّف مرفوض من قاعدة البيانات نفسها)، وتفرّد دور واحد لكل مستأجر. **بلا أي Posting Logic أو تعديل على Sales/Purchasing/Inventory أو جداول Payment/Tax/AR/AP جديدة**. تحقّق كامل بـ9 سيناريوهات: تفرّد الكود، تكامل الكتالوج، نجاح تعيين صحيح، **رفض حساب عبر-المستأجرين (`23503`)**، **رفض دور مكرّر (`23505`)**، سماح نفس الدور لمستأجر آخر، **رفض دور غير معرّف (`23503` عبر FK)**، أدوار متعددة لنفس المستأجر، RLS مطابقة (وaccount_roles العالمي بنفس علم RLS الافتراضي الموجود مسبقًا على جداول M176 العالمية — سلوك متسق وليس خللًا). tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. لم يُنشأ M184. M176–M182 لم تُعدَّل. Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**✅ M184 — Sales Posting Integration (مُطبَّقة، 2026-08-10)**: ربط `orders`/`order_items`/`stock_movements` الحالية بمحرك الترحيل في M182 — بلا Sales Invoice محاسبية جديدة، بلا Customer محاسبي جديد. **حدّان معماريان صريحان تم اكتشافهما وكشفهما بدل تجاوزهما**: (1) الدفع "split" غير قابل للترحيل — لا يوجد تفصيل cash/card في `orders` إطلاقًا، فالدالة ترفضه صراحة بدل التخمين. (2) AR غير مُستخدَم أبدًا في هذا التكامل — كل قيم `payment_method` تعني تسوية فورية، ولا توجد قيمة "على الحساب" في المخطط الحالي. **`fn_post_sales_order()`**: يقفل سجل الطلب، يتحقق من status='completed' وbranch_id، يتحقق من تطابق total=subtotal-discount+tax، يحل Accounting Owner عبر M178 وFiscal Period/Book عبر M179/M180، يحل الحسابات عبر M183 (خطأ صريح لأي دور مفقود)، **يقرأ تكلفة المخزون من stock_movements.total_cost دون أي إعادة حساب**، ثم يُرحّل عبر `fn_post_journal_entry` غير المُعدَّلة من M182. **`fn_reverse_sales_order()`**: يعكس القيد الأصلي عبر `fn_reverse_journal_entry` غير المُعدَّلة — يغطي الإلغاء بعد الترحيل والاسترجاع بنفس الآلية. **فهرس تفرّد إضافي واحد فقط** على journal_entries الموجود (`uq_journal_entries_source_original`) لضمان Idempotency/Concurrency على مستوى قاعدة البيانات، مع استثناء صريح للـReversals. **تحقّق كامل، كل السيناريوهات ناجحة**: ترحيل ناجح (Cash: 115=100+15)، خصم صافي صحيح، تعامل الضريبة الصفرية (بلا سطر زائد)، card→bank، **رفض split صراحة**، **مبيعة مخزون حقيقية على مستأجر فعلي: COGS=50 وInventory Asset=50 مقروءة من stock_movements فعليًا**، مبيعة بلا مخزون (3 أسطر فقط)، رفض عبر-المستأجرين، رفض بلا فرع، رفض دور محاسبي مفقود، رفض حساب معطّل/Header (عبر محرك M182 نفسه)، رفض فترة مغلقة، رفض الترحيل المكرر، **رفض التزامن الحقيقي (نجح واحد فقط من محاولتين متزامنتين)**، الإلغاء قبل الترحيل لا ينتج قيدًا، **الاسترجاع بعد الترحيل عبر Reversal مع بقاء القيد الأصلي محصّنًا بالكامل**، تتبّع المصدر الكامل (sales/order/order_id). tsc/build نظيفة. **Regression: 348/348 ناجح، بلا تذبذب.** Idempotency مؤكَّدة. **ملاحظة شفافية**: اختبار قراءة تكلفة المخزون تطلّب إدراج سجل حقيقي واحد في `stock_movements` على مستأجر فعلي لإثبات القراءة الصحيحة؛ تعذّر حذفه أثناء التنظيف لأن الجدول Immutable Ledger بتصميم Inventory نفسه (تم احترام هذا القيد بالكامل ولم يُتجاوَز) — السجل يتيم تمامًا (الطلب المرتبط به محذوف) ولا أثر وظيفي له، ويُفصَح عنه هنا صراحة. لم يُنشأ M185. لم تُعدَّل Sales/Purchasing/Inventory (قراءة فقط). M176–M183 لم تتأثر (فهرس إضافي واحد فقط على جدول M182). Inventory/WMS بلا تغيير. راجع STATUS.md للتفاصيل الكاملة.

**⚠️ متابعة — تعذّر تنظيف سجل stock_movements اليتيم (2026-08-10)**: فحص الطريقة المعتمدة في Inventory أكّد أن `stock_movements` محمي بـtrigger يمنع UPDATE وDELETE نهائيًا بلا أي استثناء أو دالة تصحيح/إلغاء معتمدة — استخدام adjustment_in/out لإلغائه كان سيُنتج حدث مخزون وهميًا (اختراع آلية جديدة، مرفوض). **الأثر الفعلي المُتحقَّق منه**: `ReportsService.getCogsReport()` لا يتحقق من صحة reference_id، لذا سيُضخّم تقرير COGS لهذا المستأجر تحديدًا بمقدار 50.00 وكمية 5 وحدات لصنف واحد عند أي استعلام يغطي تاريخ 2026-08-09. cost_layers/stock_levels غير متأثرة (السجل أُدرج مباشرة بلا المرور عبر fn_apply_stock_movement). لم يُعدَّل Inventory ولم تُخترع آلية جديدة. أُعيد التحقق: Idempotency سليمة، **Regression 348/348 بلا تذبذب**، M176–M184 سليمة. الأمر متروك لإجراء DBA حقيقي خارج نطاق هذه الجلسة.

**قرار مالك النظام (2026-08-10)**: M184 سليمة تمامًا؛ الحادثة ناتجة عن منهجية الاختبار (INSERT مباشر على immutable ledger) وليست خللًا معماريًا. Accounting لا تتوقف بالكامل — فقط M185 معلّقة حتى إزالة السجل عبر إجراء DBA رسمي موثّق خارج أدوات Claude؛ **لا مايجريشن لحذف السجل** (تنظيف بيانات اختبارية، ليس تغيير Schema/Business Logic). بعد تنفيذ DBA: يقتصر دور Claude على تحقّق قراءة فقط (اختفاء السجل، عودة COGS، سلامة cost_layers/stock_levels، 348/348، توثيق الحادثة كبيانات اختبارية) ثم استئناف M185.

**قاعدة اختبار دائمة جديدة (بلا استثناءات)**: يُمنع على Claude تنفيذ INSERT مباشر على `stock_movements` أو أي Immutable Ledger حقيقي أثناء الاختبار مستقبلًا. اختبارات التكامل يجب أن تمر عبر المسار الرسمي (RPC مثل fn_apply_stock_movement) أو تستخدم بيانات/fixtures معزولة قابلة للتنظيف الكامل. تُطبَّق على M185 وما بعدها.

**✅ M180–M196**: مُطبَّقة بالكامل (تحديث 2026-08-15 — يُصحّح المؤشر أعلاه الذي كان لا يزال يقول إن "التالية هي M180"؛ ذلك المؤشر كان قديمًا وتجاوزته الأحداث). راجع STATUS.md للتفاصيل الكاملة لكل migration؛ M185–M196 مُفصَّلة أدناه في هذا القسم بالضبط كما وُثِّقت في STATUS.md وعناوين ملفات الـmigration نفسها. لا بند "التالية" نشط حاليًا — راجع قسم "الوضع الحالي (Current Position)" في نهاية Phase 16 لهذا الملف.
- قواعد العمل: CLAUDE.md + rules.md

**✅ M185 — إزالة Gift Cards بالكامل (قرار منتج، 2026-08-11)**: `185_remove_gift_cards.sql` — قرار مالك النظام (Option B — إزالة كاملة بلا أثر) بعد أن كشف تحقيق Accounting Foundation (M176–M184) سؤال التزام تاريخي (historical liability) بلا إجابة نظيفة. حذف جدول `gift_cards` بالكامل (9 سجلات، 5 نشطة، رصيد تاريخي 247,264.2 — أُهدرت عمدًا بالموافقة الصريحة)، حذف عمودي `orders.gift_card_code`/`orders.gift_card_amount` (بما في ذلك 3 طلبات حقيقية مكتملة كانت تشير إليهما)، إزالة `'gift_card'` من قيم `orders.payment_method` المسموحة، حذف `fn_redeem_gift_card`، إزالة صلاحية `gift_cards.manage` ومنحها. لم تتأثر `loyalty_tiers`/`coupons`/`customer_field_definitions`. راجع STATUS.md للتفاصيل الكاملة.

**✅ M186 — دالة Accounting Bootstrap Backfill (Phase 3، 2026-08-11)**: `186_accounting_bootstrap_backfill_function.sql` — `fn_backfill_accounting_bootstrap(p_tenant_id)`، نطاق Option B (13 مستأجرًا محددًا بالاسم، القائمة يفرضها سكربت الاستدعاء لا الدالة نفسها) + Option A للطلبات التاريخية (صفر قيود يومية، لا لمس لجدول `orders` إطلاقًا). Idempotent (بوابة صريحة: أي مستأجر لديه بالفعل صف `accounting_owners` تُرجع له الدالة `SKIPPED_ALREADY_CONFIGURED` فورًا). Atomic (استدعاء واحد = معاملة Postgres واحدة). **حالة التحقق**: إنشاء الدالة **مُتحقَّق منه** (migration مُطبَّقة، تم فحص الرأس مباشرة). **تنفيذ الـbackfill الفعلي ضد قائمة الـ13 مستأجرًا غير مُتحقَّق منه** — لم يُعثر على دليل هذه الجلسة بأن سكربت الاستدعاء نُفِّذ فعليًا ضد هؤلاء المستأجرين. لا تفترض أن الـbackfill حدث. راجع STATUS.md للتفاصيل الكاملة.

**✅ M187 — Sale Idempotency (بند #1 من Migration Matrix، 2026-08-11)**: `187_sale_idempotency.sql` — `orders.sale_attempt_id` (UUID، NOT NULL، تفرّد على مستوى المستأجر) لمنع الطلبات المكتملة المكررة (نقر مزدوج، إعادة محاولة العميل، إعادة إرسال شبكي، تبويبات متعددة). نطاق محصور تمامًا بهذا العمود وتفرّده — لا لمس لـM182/M184، الترحيل المحاسبي، المخزون، الولاء، split، tab، dine-in، أو منطق الإلغاء/العكس. **معالجة السجلات التاريخية**: 133 طلبًا مكتملًا موجودًا مسبقًا لم يكن لديها `sale_attempt_id` طبيعي؛ طُبِّق `DEFAULT uuid_generate_v4()` وقت `ALTER TABLE` لإرضاء `NOT NULL` (قيمة مولَّدة آليًا بلا معنى تجاري، لا تُقرأ أو تُقارَن لأي طلب تاريخي)، ثم أُزيل الـDEFAULT فورًا بعد التعبئة — كل إدراج مستقبلي يجب أن يزوّد قيمة صريحة من التطبيق. راجع STATUS.md للتفاصيل الكاملة.

**✅ M188 — Split Payment Persistence (بند #2 من Migration Matrix، 2026-08-11)**: `188_split_payment_persistence.sql` — `orders.cash_amount`/`orders.card_amount` (قابلان للـNULL) لتخزين التفصيل الفعلي لدفعة split (نقدي/بطاقة). نطاق محصور بهذين العمودين وقيد التوافق (reconciliation CHECK) الخاص بهما — لا لمس لـM182/M184، الترحيل المحاسبي، TAB، الولاء، dine-in، الإلغاء/العكس، أو ShiftEngine. **قرار الـnullability**: تُملأ فقط عندما `payment_method='split'` — كل طريقة دفع أخرى تُخزّن NULL للعمودين (لم تُطلَب مطابقة `total` لهما لطرق الدفع غير split، فتجنّب أي توسّع دلالي غير مطلوب). **معالجة السجلات التاريخية**: 9 طلبات مكتملة موجودة مسبقًا لديها `payment_method='split'` بلا تفصيل — كلا العمودين قابل للـNULL أصلًا فلم يُطلَب أي backfill أو اختلاق بيانات. **هذه بالضبط الفجوة التي أغلقتها M194 لاحقًا (2026-08-13، راجع قيد M184 أعلاه)** — كانت `fn_post_sales_order()` ترفض split دون قيد وشرط قبل أن تضيف M194 تعيين سطرَي التسوية. راجع STATUS.md للتفاصيل الكاملة.

**✅ M189 — D01-M0: Role Hierarchy Foundation (2026-08-11)**: `189_role_hierarchy_foundation.sql` — `roles.priority` + `roles.is_hierarchy_participant`، القيم الثابتة للأدوار السبعة النظامية، انتقال آمن للأدوار المخصصة الثلاثة الموجودة، CHECK محلي لصلاحية الحالة النهائية، وtrigger BEFORE UPDATE لحماية الهوية (لا يمكن لـCHECK وحدها مقارنة OLD وNEW لمنع تحويل صف نظامي لصف مخصص أو العكس بتحديث واحد). لا لمس لـ`invoice.price_override`، سياسات/تدقيق تجاوز السعر، `order_items`، `InvoicesService`، `hasPermissionForUser`، `PermissionGuard`، أو حل الدور الفعّال — هذه migration هي أساس البيانات فقط. راجع STATUS.md وقيد "D01 (M0–M7)" أعلاه للتفاصيل الكاملة.

**✅ M190 — D01-M2: price_override_policies (2026-08-13)**: `190_price_override_policies.sql` — الجدول، قيود CHECK للنطاق/السبب/النسبة، 3 فهارس تفرّد جزئية (نطاق Tenant/Branch/Role)، trigger حارس الدور (الأدوار النظامية عدا superadmin مسموحة، الأدوار المخصصة يجب أن تطابق المستأجر وتشارك بالتسلسل الهرمي)، وRLS مطابقة لنمط M181–M184. **لم تُزرَع أي Tenant Default Policy لأي مستأجر عمدًا** — الغياب هو سلوك Fail-Closed مقصود يُفرَض لاحقًا على مستوى التطبيق (D01-M6+). راجع STATUS.md للتفاصيل الكاملة.

**✅ M191 — D01-M3: price_override_audit (2026-08-13)**: `191_price_override_audit.sql` — دفتر تدقيق/حوكمة غير قابل للتعديل (immutable) لقرارات تجاوز السعر، استراتيجية NOT NULL/ON DELETE (RESTRICT لخمس كيانات لا تُحذف نهائيًا بهذا المشروع، SET NULL فقط لـ`actor_role_id` مع لقطة دائمة `actor_role_name_snapshot`)، trigger لسلامة عبر-المستأجرين، زوج triggers للـimmutability (append-only، نفس نمط `fn_block_stock_movements_mutation`)، 5 فهارس، وRLS مطابقة. لا تحسب هذه الـmigration الفرق/النسبة/الاتجاه ولا تُنفّذ منطق تجاوز السعر — تُخزّن قيمًا سيحسبها التطبيق لاحقًا (D01-M6/M7). راجع STATUS.md للتفاصيل الكاملة.

**✅ M192 — D01-M3 Repair: actor_role_id يصبح معرّفًا تاريخيًا (2026-08-13)**: `192_price_override_audit_actor_role_historical.sql` — سبب جذري مُثبَت فعليًا أثناء تحقّق D01-M3 (وليس نظريًا): `actor_role_id REFERENCES roles(id) ON DELETE SET NULL` يتطلب من Postgres تنفيذ UPDATE داخلي عند حذف دور مُشار إليه، لكن `trg_price_override_audit_no_update` (من M191) كان يرفض أي UPDATE بلا استثناء — بما فيه هذا الـUPDATE الصادر من النظام نفسه. القرار: Option B — `actor_role_id` يتوقف عن كونه FK حيًّا فعليًا (يبقى معرّفًا تاريخيًا فقط، محميًا بلقطة `actor_role_name_snapshot` الدائمة من M191). راجع STATUS.md للتفاصيل الكاملة.

**✅ M193 — D01-M4: order_items.official_price_snapshot (2026-08-13)**: `193_order_items_official_price_snapshot.sql` — عمود واحد قابل للـNULL بشكل دائم ومقصود — لا يوجد سجل سعر تاريخي موثوق لـitems/item_variants بهذا المشروع (كلاهما حقول قابلة للتعديل الحي بلا أثر تدقيقي)، فتعبئة هذا العمود رجعيًا لـ380 سجل order_items موجود كانت ستختلق بيانات تاريخية لا يمكن إثبات صحتها — تبقى تلك الـ380 سجل NULL بشكل دائم. الدلالة (تُفرَض على مستوى التطبيق ابتداءً من D01-M7، وليس هنا): `official_price_snapshot = items.price + COALESCE(item_variants.price_adjustment, 0)`، تُلتقَط وقت حل السعر قبل التجاوز وقبل الخصم. راجع STATUS.md للتفاصيل الكاملة.

**✅ M194–M195 — Sales Posting: تعيين كامل لطرق الدفع + علم تسوية COGS + فهرس idempotency (تكامل M184، 2026-08-13)**: `194_sales_posting_payment_mapping_cogs_flag.sql` + `195_journal_entries_source_idempotency_index.sql` — راجع القيد الكامل "💰 M184 — Sales Posting Integration Complete (2026-08-13)" أعلاه في هذا الملف؛ التفاصيل الكاملة موثَّقة هناك ولن تُكرَّر هنا لتفادي الازدواج، وراجع STATUS.md كذلك.

**✅ M196 — Journal Entry Description/Reference — إزالة النص الإنجليزي المُصنَّع (2026-08-15)**: أبلغ مالك المنتج مباشرة أن واجهة قيود اليومية (عربية) كانت تعرض نصًا إنجليزيًا مُصنَّعًا مُخزَّنًا داخل `journal_entries.reference`/`description` (مثل `"POS Order <uuid>"` و`"Sales posting for order <uuid>"`) مع عرض معرّف UUID كامل (36 محرفًا) كأنه رمز مرجعي قصير. الإصلاح: `reference` أصبح يحمل فقط المعرّف المجرد بلا لغة أو بادئة؛ `description` يُترَك NULL للقيود المولَّدة آليًا (الأعمدة البنيوية `source_module`/`source_entity_type`/`source_entity_id` من M182 تكفي للتعريف الهيكلي دون تجميد نص لغوي داخل السجل)؛ سبب العكس اليدوي (`p_reason`) يبقى كما كتبه المستخدم فعليًا. الواجهة (`web/messages/{ar,en}/accounting.json`) اكتسبت مفاتيح ترجمة جديدة، وتُقصّر المرجع لآخر 8 محارف فقط (لا UUID كامل أبدًا)، وتتعرّف على نمط النص القديم بالضبط عبر regex في الواجهة فقط (السجلات التاريخية محمية دائمًا من التعديل بموجب trigger الـimmutability في M182 فلا يمكن تصحيحها بقاعدة البيانات، فقط عرضها مُترجَمة). **تحقّق حي** (إنتاج، فحص قاعدة بيانات مباشر + جلسة متصفح فعلية باسم `owner@sefay.com`): القيود الجديدة بعد هذه الـmigration تُخزَّن محايدة؛ السجلات التاريخية (بتواريخ 08-14/08-15 السابقة لهذا الإصلاح) تُعرَض مُترجَمة عبر آلية التعرّف بالواجهة. **Commits**: API `5b090d9` (migration + مجموعة اختبارات H02)، Web `0c08015` + `de04693` (ترجمة + منطق العرض).

**✅ D01 (M0–M7) — استكمال بعد قيد "Implementation, Live Validation, and Git Sync Complete" أعلاه**: القيد الكامل لـD01-M5/M6/M7 موثَّق بالفعل أعلاه في هذا الملف ("🚀 D01 (M0–M7) — Implementation, Live Validation, and Git Sync Complete (2026-08-13)") — لن يُكرَّر هنا. **تحديث مهم غير موثَّق في ذلك القيد**: علم `POOLED_INVOICE_WRITES_ENABLED` المذكور هناك بقيمة `false` كان صحيحًا وقت كتابته (2026-08-13) فقط؛ تجاوزته الأحداث لاحقًا عبر H01 (راجع أدناه) — أصبح `true` فعليًا في الإنتاج اعتبارًا من 2026-08-15 ولا يزال كذلك. راجع STATUS.md للتفاصيل الكاملة المحدَّثة.

**✅ Accounting Backend Phase 1 (تاريخ البناء الأصلي/commit غير مُتحقَّق منه بشكل مستقل هذه الجلسة)**: **مؤكَّد موجود وفعّال**، تحقّق مباشر عبر سجلات مسارات Railway الإنتاجية هذه الجلسة: `AccountingController` مربوط على `/api/v1/accounting`، بمسارات حية `fiscal-periods`، `cogs-reconciliation`، `chart-of-accounts`، `owners`، `branch-assignments`، `command-center`، `journal-entries`، `journal-entries/:id`، `price-override-audit/:id` — جميعها ترجع `200` لطلبات حقيقية موثَّقة هذه الجلسة. **فجوة**: تاريخ البناء الأصلي ورمز الـcommit لم يُعاد التحقق منهما بشكل مستقل هذه الجلسة — فقط الحالة الحالية الفعّالة مُؤكَّدة. راجع STATUS.md للتفاصيل الكاملة.

**✅ Accounting UI Phase 1 (تاريخ البناء الأصلي/commit غير مُتحقَّق منه بشكل مستقل هذه الجلسة)**: **مؤكَّد موجود وفعّال**، تحقّق مباشر عبر قراءة الملفات وجلسة متصفح فعلية باسم `owner@sefay.com` هذه الجلسة: `AccountingCommandCenterPage.tsx`، `AccountingConfigurationPage.tsx` (الفترات المالية، المسؤولون المحاسبيون، ربط الفروع، دليل الحسابات)، `JournalEntriesListPage.tsx` + `JournalEntryDetailSheet.tsx`، `CogsReconciliationPage.tsx`، `PriceOverrideAuditPage.tsx` + `PriceOverrideAuditDetailSheet.tsx`، `AssignBranchOwnerSheet.tsx`. **فجوة**: نفس فجوة Accounting Backend Phase 1 أعلاه. راجع STATUS.md للتفاصيل الكاملة.

**✅ H01 — Controlled Accounting Go-Live (2026-08-15)**: "APPROVED — PROCEED WITH H01 CONTROLLED ACCOUNTING GO-LIVE." تنفيذ الإجراء المعتمد: 5 فحوصات مسبقة (H02 28/28، git HEAD `0cabf02`، شجرة عمل نظيفة، Redis + API فعّالان، العلم مؤكَّد `false` قبل البدء)، `railway variables --set POOLED_INVOICE_WRITES_ENABLED=true`، `railway redeploy --yes`. **النشر**: `7ec962b2-9db1-45bf-8d0d-e94362973c54` (تجاوزه لاحقًا نشر لاحق غير مرتبط `b9a1b362` من دفع commit بنفس اليوم — العلم بقي دون تغيير عبر إعادة النشر). **5 اختبارات دخان** ضد المستأجر التجريبي الموجود (`9bcd3369-...`) بمستخدم اختبار مؤقت، بلا أي بيانات دائمة جديدة: مبيعة نقدية (نجاح)، دفعة split (نجاح)، تجاوز السعر (جزئي — العلم نفسه أُزيل لكن حجبته فجوة D01 منفصلة سابقة الوجود `no_effective_role`، عولجت لاحقًا)، إلغاء/عكس (نجاح)، تحديث مركز القيادة (نجاح). **القرار**: العلم بقي `true`. لا شرط تراجع (rollback) تحقّق. راجع STATUS.md للتفاصيل الكاملة.

**✅ H02 — Accounting SQL Regression Suite (2026-08-15)**: مجموعة 28 سيناريو تغطي `fn_post_journal_entry`/`fn_reverse_journal_entry`/`fn_post_sales_order`/`fn_reverse_sales_order`، مُضافة في `api/src/database/migrations/__tests__/accounting-posting-engine.regression.spec.ts`. 28/28 ناجحة. مُدمَجة مع M196 في commit `5b090d9`. تعارضان تصميميان ظهرا وحُلّا بقرار صريح من المستخدم لا بتعديل صامت: السيناريو #6 (إغلاق فترة مالية) أُجِّل — لا توجد أي فترة مالية مغلقة حيًّا بأي مكان؛ السيناريو #19 أُعيدت صياغته ليؤكد رفض `orders_payment_method_check` الفعلي على مستوى الجدول بدل فرع `ELSE` الميت داخل الدالة نفسها. راجع STATUS.md للتفاصيل الكاملة.

**✅ H03 / H03-B — تدقيق وتصنيف جاهزية محاسبة الفروع (2026-08-15)**: تدقيق للقراءة فقط لحالات الـ9 فروع غير المربوطة التي كشفها تدقيق Pre-Launch Hardening السابق. صُنِّفت كل الـ9 كـTEST-FIXTURE (مخرجات مجموعة اختبارات H02، بأسماء `H02-unassigned-branch-*`)، صفر حالات REAL PRODUCTION أو UNKNOWN. لم يُنشأ أي ربط، لم يُختَر أي مسؤول — تصنيف فقط بالضبط كما طُلِب. راجع STATUS.md للتفاصيل الكاملة.

**✅ H04 — استراتيجية اختبار الواجهة الأمامية الآلية (2026-08-15، خُفِّضت إلى P2)**: تصميم/تدقيق فقط، بلا كود أو تثبيت. تدقيق حالة الاختبار الحالية بـ`web/` (مؤكَّد: لا إطار اختبار مُثبَّت) وتوصية بـVitest + RTL + Playwright. بناءً على الأدلة المجمَّعة (عيّنة حركة إنتاج صغيرة، صفر حوادث مستخدم فعلية عُثِر عليها بجولات المراقبة هذه الجلسة)، خُفِّضت من P1 إلى **P2** — لم يبدأ أي تنفيذ. راجع STATUS.md للتفاصيل الكاملة.

**✅ D01 — سياسة تجاوز السعر بالإنتاج + التحقق النهائي من طرف إلى طرف PASS (2026-08-15)**: "Approved – Proceed with creating the D01 Tenant Default Price Override Policy and run the final production E2E validation." أولًا شُخِّص السبب الجذري لنتيجة H01 الجزئية (تدقيق فقط، بلا كود): مستخدم الاختبار المؤقت المستخدم بـH01 لم يكن لديه أي صف `user_roles` (أُنشئ خارج مسار التسجيل العادي)، فحلّ بشكل صحيح إلى `no_effective_role` — ليس خللًا بالدالة. تأكَّد أن `owner@sefay.com` (مستخدم حقيقي فعّال بالمستأجر) يحلّ فعليًا لدور فعّال `owner`/أولوية 90، مع صلاحية `invoice.price_override` ممنوحة. **سياسة أُنشئت** — صف Tenant Default Policy واحد للمستأجر التجريبي: `allow_discount=true, max_discount_percent=15, allow_increase=true, max_increase_percent=15, allow_combine_with_discount=false, reason_policy=required_above_threshold, reason_threshold_percent=10, allow_zero_price=false`، بـ`created_by` = المستخدم المالك الحقيقي (وليس NULL كبيانات اختبارية). **اختبار إنتاج فعلي من طرف إلى طرف، باسم `owner@sefay.com`، عمدًا عند الحد الأقصى 15% بالضبط**: السعر الرسمي 5.00 ← السعر المطلوب 4.25 (خصم 15%). (1) حل السعر: السعر الرسمي مُحلّل من الخادم، السعر المطلوب مختلف، الدور الفعّال=owner، الصلاحية=ممنوحة، السياسة=موافَق عليها — أكَّد حد 15% شامل (inclusive) حيًّا (هذا الخصم بالضبط 15% ونجح). (2) الطلب أُنشئ بنجاح. (3) `order_items.official_price_snapshot` = 5 (السعر الرسمي قبل التجاوز، محفوظ). (4) `order_items.price` = 4.25 (السعر المعتمد بعد التجاوز). (5) صف `price_override_audit` واحد بالضبط أُنشئ، يحتوي: السعر الرسمي، السعر المعتمد، الفرق (قيمة ونسبة)، الاتجاه (discount)، نص السبب، الفاعل، `actor_role_name_snapshot="owner"`، ولقطة كاملة للسياسة وقت الموافقة. (6) قيد يومية محاسبي أُنشئ ورُحِّل، متوازن بالكامل. (7) الذرّية (atomicity) مؤكَّدة: الطلب، عناصر الطلب، صف التدقيق، وقيد اليومية تشترك جميعًا بنفس الطابع الزمني تمامًا — معاملة واحدة مجمَّعة، بلا أي فجوة كتابة جزئية. (8) الطلب أُلغي بعدها: الطلب ← `cancelled`؛ قيد اليومية الأصلي ← `reversed`؛ قيد عكسي جديد رُحِّل بمبادلة صحيحة للمدين/الدائن على كل سطر ومرتبط عبر `reversal_of_id` — متوازن. **النتيجة: D01 PRICE OVERRIDE E2E = PASS.** لا شرط تراجع تحقّق، العلم بلا تغيير (`true`). المعرّفات التقنية الكاملة لهذا الاختبار موثَّقة بسجل محادثة هذه الجلسة الهندسية؛ حُذفت هنا كتفصيل غير ضروري لسجل المشروع بعد ما ذُكِر أعلاه. راجع STATUS.md للتفاصيل الكاملة.

**✅ F2 — Shared Postgres Error Helpers (2026-08-15)**: "Approved — Proceed with F2 implementation." استخراج `isPostgrestError` / `isUniqueViolation` / `isForeignKeyViolation` إلى `src/shared/supabase/postgrest-error.util.ts` — دوال منطقية (boolean predicates) خالصة، بلا إنشاء استثناءات. تهجير 20 ملفًا (12 ملفًا كان لديها `isPostgrestError` مكرَّرة حرفيًا بشكل متطابق، 8 ملفات كانت تفحص `error.code === '23505'/'23503'` مباشرة) لاستخدام الدوال المشتركة — صفر تغيير في أصناف الاستثناءات أو الرسائل أو رموز HTTP بأي مكان. **حالتان خاصتان محفوظتان تمامًا**: sentinel الخاص بـ`access-control.repository.ts` (`throw new Error('DUPLICATE_ROLE_NAME')`، ليس استثناء HTTP)؛ فرع استرداد التسابق (race-recovery) الخاص بـM187 في `invoices.service.ts` (بحث قاعدة بيانات + تشكيل 409، وليس رفضًا بسيطًا) — فقط الشرط المنطقي استُبدل بكل منهما. **تحقّق**: اختبارات الأداة الجديدة 10/10؛ 13 مجموعة اختبار للوحدات المتأثرة، 125/125؛ المجموعة الكاملة للخلفية 466/471 (5 حالات فشل موجودة مسبقًا — `serial-tracking-13.14.regression.spec.ts`، `scanner-event-engine-13.21-phase4.regression.spec.ts` — أُعيد إنتاجها مطابقة تمامًا على الأساس السابق لـF2 عبر `git stash`، مؤكَّد أنها غير مرتبطة (انجراف مخطط/انتهاء مهلة)، وليست بسبب هذا التغيير)؛ H02 28/28؛ `tsc --noEmit` نظيفة؛ `nest build` نظيف؛ ESLint — صفر نتائج جديدة مقارنة بالأساس السابق للتغيير (تحقّق لكل ملف عبر `git stash`). **Commit**: `5fabea3`، مدفوع لـ`origin/main`. راجع STATUS.md للتفاصيل الكاملة.

---

**⬜ Access Control — بند مؤجَّل غير عاجل (وُثِّق 2026-08-11): الحل الدائم لـPlatform-Only Permissions**

راجعتُ نظام Access Control بالكامل (§68 وما بعده بـSTATUS.md) بناءً على طلب مباشر للتحقق من عدم وجود مشاكل. **لا توجد مشكلة أمنية نشطة اليوم** — كل الثغرات المكتشفة سابقًا (تصعيد صلاحيات owner إلى بيانات المنصة عبر `analytics.view.all`/`audit.view.all`، تسريب نفس الصلاحيتين في قائمة العرض، تجاهل `tenant_role_permissions` للأدوار المخصصة) **مُعالَجة فعليًا ومؤكَّدة بالكود الحي والاختبارات (27/27 وقتها)**.

**الباقي مفتوح، غير عاجل، موثَّق بالكود نفسه كـStopgap**: الحل الحالي لحظر الصلاحيات "الخاصة بالمنصة فقط" هو قائمة مُثبَّتة يدويًا بالاسم:
```ts
// src/modules/access-control/platform-only-permissions.const.ts
export const HARDCODED_PLATFORM_ONLY_KEYS = new Set(['analytics.view.all', 'audit.view.all']);
```
هذه لا تعمّم تلقائيًا — أي صلاحية جديدة "عبر-مستأجرين" تُضاف مستقبلًا (غير هاتين الاثنتين) **لن تُحظَر تلقائيًا من الظهور/التخصيص في واجهة `/access-control`** إلا إذا أضافها أحد يدويًا لنفس القائمة. الخطر الفعلي منخفض لأن `SuperAdminGuard` يبقى خط الدفاع الحقيقي على كل مسار `/superadmin/*` بغض النظر عن الصلاحية.

**الحل الدائم المُوصى به (لم يُنفَّذ، لا يبدأ إلا بموافقة صريحة منفصلة)**: عمود `is_platform_only BOOLEAN` صريح على جدول `permissions`، بدل الاعتماد على قائمة أسماء مُثبَّتة بالكود — يحتاج Architectural Audit + Migration منفصلة وفق نفس بروتوكول الموافقة القائم. **لا تنفيذ الآن — بند مؤجَّل بطلب المالك.**

---

**⏸️ Multi-Role Per User — Backend مبني بالكامل، بلا UI (موثَّق 2026-08-11، مؤجَّل بطلب المالك)**

أثناء تدقيق Access Control، اكتُشف أن دعم "أكثر من دور لكل مستخدم" **موجود فعليًا ويعمل في الخلفية** — يخالف ملاحظة سابقة بـSTATUS.md §68 كانت تصفه بأنه "غير مبني بعد عمدًا"؛ تلك الملاحظة **قديمة/غير دقيقة الآن**، إذ ظهر أن الـAPI بُني لاحقًا (على الأرجح خلال §86 "PHASE 3 (Frontend)" أو ما بعدها، بلا توثيق صريح لهذا الجزء تحديدًا). **دليلان حقيقيان بالإنتاج** (`sh@sh.com` و`claude.test.local@sefay-test.com`) لديهما فعليًا دوران كل منهما (`owner`+`cashier`)، مُضافان عبر هذا المسار بتاريخي `2026-07-13`/`2026-07-17` (مُثبَت بـ`user_roles.created_at` + بيانات جهاز حقيقية بـ`audit_logs` تستبعد أي تلاعب لاحق أو من طرف Claude، الذي لم يكتب على `user_roles` إطلاقًا).

**الموجود فعليًا وجاهز للاستخدام الآن، بلا أي عمل إضافي:**
- `GET /users/:id/roles` — قراءة (`users.view`).
- `POST /users/:id/roles` `{role_id}` — إضافة دور (`users.manage`، مُدقَّق `user.role.added`).
- `DELETE /users/:id/roles/:roleId` — حذف دور (`users.manage`، مُدقَّق `user.role.removed`).
- الجدول `user_roles` نفسه (`086_create_user_roles.sql`)، `UNIQUE(user_id, role_id)` — يدعم عدة أدوار لكل مستخدم بنيويًا منذ إنشائه.
- Repository كامل: `users.repository.ts` (`findUserRoles`, `insertUserRole`, `deleteUserRole`, `findAccessibleRole`) + Service (`users.service.ts:391` `addRole`, `:426` `removeRole`).
- Frontend: دوال استدعاء API جاهزة في `web/src/features/users/api/users.api.ts:167-173` (`GET`/`POST`/`DELETE` roles) — **لكن غير مُستخدَمة من أي مكوّن/صفحة واجهة إطلاقًا** (تحقّق مباشر: صفر نتائج لاستدعاء هذه الدوال في أي `.tsx`).

**القرار (2026-08-11، طلب المالك)**: **لا حذف، ولا بناء واجهة الآن.** الإبقاء على الكود الخلفي كما هو (ساكن، بلا تكلفة صيانة حقيقية، محمي بصلاحية صحيحة). بناء واجهة "إضافة/حذف دور ثانٍ" لصفحة تفاصيل المستخدم (`/dashboard/users/:id` أو ما يعادلها) **مؤجَّل حتى يظهر سيناريو عمل حقيقي يستدعيه** (مثال: موظف يعمل كاشير في وردية ومدير في أخرى).

**عند الرغبة في البناء لاحقًا — لا حاجة لأي عمل خلفي جديد، فقط Frontend:**
1. استخدام `getUserRoles`/`addUserRole`/`removeUserRole` الموجودة أصلًا في `users.api.ts` (لا تعديل خلفي مطلوب).
2. إضافة قسم "الأدوار" داخل صفحة تفاصيل المستخدم: قائمة الأدوار الحالية (من `GET`) + زر "إضافة دور" (قائمة منسدلة من كتالوج الأدوار المتاحة للتينانت) + زر حذف لكل دور غير أساسي.
3. حماية الزر بصلاحية `users.manage` على مستوى الواجهة (مطابقة لما يفرضه الخلفي أصلًا).
4. لا حاجة لأي migration أو تعديل RBAC — كل شيء جاهز.

---

## 📍 الوضع الحالي (Current Position) — Phase 16 (2026-08-15)

هذا القسم يُضاف في نهاية Phase 16 بالضبط كما طُلِب صراحة، ليكون المرجع الوحيد الحالي للموقع الفعلي داخل هذه المرحلة، بدل الاعتماد على المؤشر القديم الذي كان يشير خطأً لـM180 كـ"التالية" (صُحِّح أعلاه في هذا القسم أيضًا).

- تنفيذ Phase 16 حتى M196 **مكتمل**.
- D01 M0–M7 **مكتمل**.
- Accounting Backend Phase 1 **مكتمل**.
- Accounting UI Phase 1 **مكتمل**.
- H01–H04 **مكتملة/مصنَّفة** كما وُثِّق أعلاه في هذا القسم (H04 مُصنَّفة P2).
- F2 **مكتمل**.
- D01 Production Price Override E2E **مكتمل (PASS)**.
- **لا يوجد أي بند تنفيذ "تالٍ" معتمد حاليًا بخارطة الطريق.**
- البندان المتبقيان المذكوران أعلاه (Access Control platform-only permissions، وMulti-Role Per User frontend UI) **يبقيان مؤجَّلين بقرار المالك** بالضبط كما وُثِّقا أعلاه — لم يُرقَّيا ولم يُعاد تسميتهما ولم تُحذَف أسباب تأجيلهما.
- أي مرحلة أو بند تنفيذ جديد يتطلب **قرار مالك صريح ومنفصل** قبل البدء.

راجع STATUS.md (الإدخالات المُلحَقة اعتبارًا من commit `5998e20`) للتفاصيل الكاملة والأدلة الداعمة لكل بند أعلاه.
---

## 🧾 الطلبات المعلقة (Held/Pending Orders) — 2026-11-08

بلاغ المالك بلقطة شاشة: صفوف «معلقة» تظهر في صفحة الطلبات رغم حذفها من شاشة الطلبات المعلقة في الكاشير. التشخيص الكامل (المصدران الوحيدان لـ`status='pending'`، السبب الجذري، نطاق الأثر المؤكَّد على التقارير، طرق الإكمال الفعلية) في `STATUS.md` — قسم «الطلبات المعلقة (Held/Pending Orders)» بتاريخ 2026-11-08.

- [x] **إصلاح الصفوف الشبحية** — `InvoicesRepository.findAll()` لم يكن يفلتر `deleted_at` إطلاقًا، بعكس `findHeldOrders()`. أُضيف `.is('deleted_at', null)`. تعديل استعلام فقط: بلا Schema/Migration/DDL/تغيير عقد API. محليًا فقط، غير مدفوع. لم يُختبَر بالمتصفح — المالك هو المُختبِر.
- [ ] ⏸️ **مؤجَّل بقرار المالك (2026-11-08)** — إخفاء الطلبات المعلقة الحيّة (`held=true`) من قائمة الطلبات لتبقى حصرًا في شاشة الكاشير. قرار منتجي: يغيّر معنى حبة الفلترة «معلقة» (ستقتصر على طاولات dine-in المفتوحة).
- [ ] ⏸️ **مؤجَّل بقرار المالك (2026-11-08)** — تصحيح دلالة الحالة في `cancelHeldOrder` (يترك `status='pending'` للأبد على سجل محذوف). أثر مرئي صفر اليوم؛ يتطلب التفريق بين مساري الحذف والاستئناف لأن نفس الدالة تخدمهما معًا.

نص قرار الإيقاف الحرفي: **«وقف وثق الي سويتها في ملفات التوثيق وراح نعمل عليه»**.


---

<!-- HISTORICAL-RECONSTRUCTION-2026-11-08 -->
## 📍 Reconstructed Position (2026-11-08)
- Committed & pushed (GitHub main == local HEAD, both repos): everything through api `ebb1d9d` and the current web HEAD.
- Local only, uncommitted: api migrations 197-250 and modules rewards / expenses-v2 / branches / WMS (see STATUS.md "Historical Reconstruction" A-C); web rewards, expenses-v2, branches, i18n.
- Risk: `start:prod` runs `migrate.js`; pushing 197-250 applies them to the live DB at deploy. Applied status today is UNVERIFIED.
- Open owner decisions: fate of uncommitted code (split into commits vs push as-is vs keep local); 4 api + 1 web unmerged GitHub branches; owner@sefay.com credential literals in public `testsprite_tests/`.
- Retention fixed 2026-11-08 (`cleanupPeriodDays: 3650`); the 5 surviving Sefay transcripts are recorded in `C:\Fp\session-history\`.


- **Update 2026-11-08 (verified):** migrations 197-250 ARE applied on the live DB (249/249, see STATUS.md "Live-DB verification"). Remaining risk is the uncommitted code, not the schema.


---

<!-- DEFECT-BACKLOG-2026-11-08 -->
## Defect Backlog (2026-11-08) - found by reading code, NOT fixed

Verification pass 2026-11-08: D1-D7 and the listed parts of D8/D10 re-checked directly in code (see row notes). Unchecked: D9, D11, D12, birthday/campaign, cancel/wave parts.

Source: code-derived documentation in STATUS.md ("Code-Derived Behavior Documentation 2026-11-08"). Status column: VERIFIED = checked directly in code by me; AGENT-REPORTED = from a read-only agent report, re-check before fixing. Nothing below has been changed; each fix needs owner approval (Execution Gate).

### P1 - feature does not work at all
| # | Defect | Status | Where |
|---|---|---|---|
| D1 | spend_threshold rewards never unlock: web sends `trigger_config.threshold`, DB function reads `amount` | VERIFIED | web RewardFormModal.tsx:83 vs api migration 217 line 51 |
| D2 | Category rewards need `count` in trigger_config; form does not send it | VERIFIED 2026-11-08 | form sends only category_id (RewardFormModal.tsx:85); fn reads count (migration 216:47) |
| D3 | `tenants.rewards_enabled` is never read; birthday and campaign rewards are created but never evaluated | VERIFIED for rewards_enabled (only in migration 205, no .ts reads it); birthday/campaign not evaluated still agent-reported | api/src rewards |

### P2 - data or security correctness
| # | Defect | Status | Where |
|---|---|---|---|
| D4 | Branch-scope check missing in expenses-v2: only list is @BranchScoped; findOne/update/cancel/confirm-payment/stop-recurring/attachments take only tenant+id | VERIFIED 2026-11-08 (controller) | api/src/modules/expenses-v2 |
| D5 | Reward redemption happens before invoice creation, no rollback if invoice fails | VERIFIED 2026-11-08: invoices.service.ts:467 redeems, repo.create at :528, catch block :575-603 has no release | rewards redemption |
| D6 | User permissions (migration 090) are shadow-only unless `ENFORCE_HYBRID_PERMISSIONS=true` | VERIFIED 2026-11-08 (permission-resolution.util.ts:18 + guard spec) | migration 090 |
| D7 | Variant SKU counter wraps at 100 (`seq % 100`), duplicate SKUs possible | VERIFIED 2026-11-08: items/utils/sku.util.ts:10 uses sequence % 100 | migration 139 |
| D8 | `fn_confirm_pick` ignores pick-list status; cancel acts on whole shipments; wave auto-completes after its only pick list is cancelled | fn_confirm_pick pick-list-status gap VERIFIED 2026-11-08 (migration 243 reads the line only, no pick_lists.status check); cancel and wave parts still agent-reported | WMS migrations |
| D9 | Company-level transfer leaves the blocking layer in place (146) | AGENT-REPORTED | migration 146 |

### P3 - quality and gaps
| # | Defect | Status |
|---|---|---|
| D10 | expenses-v2 and branches have no specs; no expense approval workflow; tax re-run issue | no specs VERIFIED 2026-11-08 (0 spec files in expenses-v2 and branches); approval workflow/tax re-run still agent-reported |
| D11 | WMS tests run against the live DB and are not in CI | AGENT-REPORTED |
| D12 | Analytics (143) double-counting; supplier items ignored by safety stock (159); dine-in tax ignores tax_inclusive_pricing; subcontracting statuses unreachable (157) | AGENT-REPORTED |

### Open decisions for owner
- Order of work and whether to start with D1-D3 (rewards).
- Fate of the uncommitted code (see Reconstructed Position above): fixes should land together with that decision.

### Verification pass 2 (2026-11-08) - corrections to the backlog above (append-only)
- D3 birthday/campaign: reclassified BY DESIGN. reward-eligibility.service.ts:14-30 states they are configurable via CRUD but intentionally not evaluated (no automatic event); only purchase_count, spend_threshold, product_category are order-evaluated, loyalty_points via a separate path. Only the rewards_enabled finding stays a defect (flag unused).
- D8 wave auto-completion: VERIFIED but matches an owner-specified rule (migration 248 lines 189-197: completed + cancelled = wave completed; counts only pick lists not in completed/cancelled). Open question only: a wave whose ONLY pick list is cancelled becomes `completed` rather than `cancelled`. Not a bug against the stated rule.
- D11 CI: VERIFIED and WIDER than reported: .github/workflows/api.yml runs only `npm ci` and `npm run build` (lines 28-31); NO test step at all, not just WMS tests.
- D12 safety stock: PARTLY VERIFIED: fn_calculate_safety_stock (159) takes lead time from inventory_reorder_points then purchase_orders/goods-receipt history, never supplier_items.
- STILL UNVERIFIED (agent-reported only): D9 (146 company transfer leaves blocking layer), fn_cancel_shipment acting on whole shipments, 143 double counting, 157 unreachable statuses, dine-in tax ignoring tax_inclusive_pricing, expense approval workflow gap (only an approval_status column exists in expenses-v2; no approve endpoint seen), expense tax re-run.


---

<!-- DEFECT-BACKLOG-POS-SHIFTS-EXPENSES-PRINTER-2026-11-08 -->
## Defect Backlog 2 (2026-11-08) - POS, cash drawer/shifts, expenses, printing

Source: code-only review (no runtime test, no live DB). Full reports in the session scratchpad (review_pos_printer.md, review_shifts.md, review_expenses.md). V = I re-read the exact code myself; A = subagent report, file:line evidence in its report, not re-checked by me. Nothing here is fixed. Fixes need owner approval (Execution Gate).

Decision 2026-11-08 (owner): the legacy expenses page is NOT wanted in the sidebar; expenses-v2 is the one to use. Done in web: sidebar now links /dashboard/expenses-v2/expenses (nav.config.ts, DashboardSidebar.tsx). Legacy page and the dashboard "new expense" button (DashboardOverview.tsx:680) still point to legacy.

### POS (invoices)
| # | Sev | Defect | Status |
|---|---|---|---|
| P1 | HIGH | Loyalty points and reward instances are consumed before the order transaction and never refunded if insert/accounting fails; web keeps the same sale_attempt_id so a retry burns them again | A |
| P2 | HIGH | PaymentModal uses remainingDue = cart.total (loyalty/reward discounts ignored): split payment sends a card amount that mismatches the server total -> 400; cash change on receipt understated | V (PaymentModal.tsx:97-110) |
| P3 | MED | No return/refund path, only full cancel; cancel does not reverse loyalty, coupon or reward redemptions | A |
| P4 | MED | Stock deduction is best-effort after commit; silently skipped when branch has no default_warehouse_id; COGS not in sale journal (flagged for reconciliation only) | A |
| P5 | MED | Dine-in checkout is a weaker separate path: no accounting posting, no shift check, no idempotency, split not persisted, tax always exclusive; fn_checkout_dine_in_table frees the table even if the order update matches no rows | A |
| P6 | MED | Cancel and GET :id have no @BranchScoped (cross-branch access inside a tenant) | A (inferred) |
| P7 | LOW | No minimum item count on DTO; coupon race loss only logged; free_item rewards not added as order lines; orders list omits cash_amount/card_amount; 409 "already created" on retry does not open the receipt | A |

### Cash drawer / shifts
| # | Sev | Defect | Status |
|---|---|---|---|
| S1 | HIGH | No unique constraint for one open shift per cashier (only non-unique idx_shifts_cashier_open, 001:726); check is read-then-insert -> race gives two open shifts | V |
| S2 | HIGH | assertOpenSession checks only that the shift is open in the tenant, not cashier or branch; shift_id comes from the client body | V (shifts.service.ts:196-211) |
| S3 | HIGH | Expenses reduce expected cash only if expense.shift_id is set; it is optional and no web expenses code passes it; all approved expenses treated as cash with no payment source -> expected cash likely wrong | A |
| S4 | HIGH | No cash-in/out and no refund handling; only status=completed orders count; cancel after close does not adjust expected_cash; no cash movements table | A |
| S5 | MED | wallet, mada, visa and other methods fall in neither cash nor card in the summary | A |
| S6 | MED | Close is not atomic (summary read then update, no status=open guard) -> sale between reads excluded, double close can overwrite | A |
| S7 | MED | Close notes accepted but never saved; no accounting entry for variance; closed-shift immutability only in app code, no DB trigger | A |
| S8 | MED | GET /shifts/current with branch scope returns any cashier's open shift; another cashier's POS sells into it and then gets "Not your shift" on close | A |
| S9 | LOW | Shift summary has no ownership check and recomputes live (can differ from stored expected_cash); web types say close returns Shift but API returns {shift, summary}; CloseShiftModal shows no expected cash or variance; repo reads swallow errors and return null/[]; no shifts specs | A |

### Expenses (v2 is now the active module)
| # | Sev | Defect | Status |
|---|---|---|---|
| E1 | HIGH | Inclusive-tax edit divides twice: stored amount is pre-tax, edit form preloads it (ExpenseFormSheet.tsx:137) and resends with tax_mode inclusive, update() treats it as the total (expenses-v2.service.ts:468-480) -> amount shrinks on every save | V |
| E2 | HIGH | Same bug in recurring generation (service ~691-696) for inclusive-tax sources | A |
| E3 | MED | Possible duplicate recurring runs: occurrence inserted, then next_occurrence_date update unchecked, no lock/unique (source,date), multi-instance cron risk | A |
| E4 | MED | No accounting (journal) and no shift cash-drawer link anywhere in expenses-v2; dashboard reads legacy data only | A |
| E5 | MED | Paid expenses editable with no old-value history; recurring_end_date/expense_date not range-checked; changing frequency does not recompute next_occurrence_date | A |
| E6 | MED | Only findAll is @BranchScoped; findOne/update/cancel/confirm-payment/stop-recurring/attachments take tenant+id only; no spec files | V (see Backlog 1, D4/D10) |
| E7 | LOW | findAll has no pagination/totals, search wildcards unescaped; attachments no MIME allow-list, allowed on cancelled expenses, orphan file on failed insert; scheduler uses UTC dates; UPDATEs lack status predicate; cancelling a recurring source leaves is_recurring true; no deleted_at/delete endpoint (inferred) | A |
| E8 | CHECK | Runtime checks needed: migration 199 widening tax_mode CHECK to allow none; expense_activity CHECK list (edited, payment_confirmed, department_changed) - insert failures are swallowed | A |
| E9 | MED | Legacy expenses module still registered and reachable; dashboard "new expense" button still links to legacy | V |

### Printing
| # | Sev | Defect | Status |
|---|---|---|---|
| R1 | HIGH | Only browser window.print() exists (ReceiptModal, OrderDetailsModal, OrdersPage); no ESC/POS, thermal, WebUSB/Serial/Bluetooth anywhere | A |
| R2 | HIGH | No print CSS (no @media print / print: / @page) in POS or receipt files -> prints likely the whole page, not an 80mm slip | V (no match outside Attend/Settings pages); behavior itself unverified |
| R3 | MED | Settings paper width (58/80) and auto-print toggle are saved to tenants.printer_settings but nothing reads them; printer_name exists only in the web type | V (only SettingsPage + settings.api reference them) |
| R4 | MED | Receipt ignores stored business name, logo, tax number, footer; invoice number is last 6 chars of UUID; tab payments labelled "card" | A |

### Needs runtime check by owner
Split payment with loyalty/reward (expect 400); what window.print() prints from POS and Orders; points lost when posting fails; null default_warehouse_id behavior; POOLED_INVOICE_WRITES_ENABLED true in production (default false, local .env true); accounting role/branch assignment exists per tenant; whether a later migration changed shifts constraints; role permissions seed shift.*.

### Open decisions for owner
Fix order (suggested: E1/E2 first since v2 is now live, then S1-S4 cash correctness, then P1/P2, then printing); whether dashboard "new expense" button moves to v2; whether legacy expenses module is retired.



---

<!-- SUNMI-PRINTING-TASKS-2026-11-08 -->
## Printing + Sunmi pilot - task list (2026-11-08, nothing built yet)

Full research and sources: STATUS.md section "Sunmi Printing - researched method and decisions (2026-11-08)".

| # | Task | Status |
|---|---|---|
| T1 | Web: receipt template + print CSS 58/80 mm (business name, logo, tax number, footer, invoice fields; English numerals) | not started, awaiting owner go-ahead |
| T2 | Web: single printReceipt() with drivers: Sunmi via sunmi-js-sdk (JS USDK on device) -> fallback browser print | not started |
| T3 | Web: make printer_settings real (paper width, auto print), per-device choice Sunmi/phone/tablet/computer stored locally, reprint from Orders | not started |
| T4 | Owner test on a real Sunmi device: https page -> ws://localhost:7070, JS USDK on the model, ARABIC printing, silent auto-print | owner action, after T1-T3 |
| T5 | pos_m (Expo WebView + maintained Sunmi library) | only if T4 fails or native features are needed; location C:\Fp\pos_m per docs |
| T6 | Before the free pilot: fix or disclose S1-S4, E1/E2, P2 (Defect Backlog 2) | open decision |
| T7 | Update the STATUS.md top "Application Layer Deferral" text to point to the 2026-08-20 rule in CLAUDE.md | optional, owner decision |



---

<!-- TASK-T8-S3-2026-11-08 -->
## Task T8 (owner order 2026-11-08): fix S3 - cash expenses must reduce expected cash at shift close

- Priority: HIGH, before the free car wash pilot. Status: OPEN, design not yet written.
- Why: expenses are entered by the owner on the website only (not in the Android app), and expenses-v2 has no link to shifts, so a cash expense paid from the drawer is not deducted from expected cash (shortage appears at close).
- Next step: architectural review (Audit, Database Design, Business Rules, State Machine, Migration Matrix) covering S1-S6 together; options are listed in STATUS.md section "Owner decisions 2026-11-08". No code or migration before the exact message "Approved - Proceed with Implementation".
- Also recorded: Android app scope decisions (expenses not in the app; screens for v1; Kotlin recommended but not yet confirmed) - see the same STATUS.md section.



---

<!-- POS-RUNTIME-TEST-2026-11-09 -->
## POS runtime test results (2026-11-09) - local api (3001) + local web (3000), live Supabase, demo tenant 9bcd3369

Provenance: tested in the in-app browser as owner@sefay.com, Redis local container, POOLED_INVOICE_WRITES_ENABLED=true. Test data written to the LIVE demo tenant (owner approved): 5 invoices by the assistant (#544033 cash 28.75 with 50 tendered, #9E04D1 mada 5.75, #CC04C2 split 28.75, #0BB436 split+coupon 25.88, #7079A2 cash 5.75 cancelled) plus about 5 earlier invoices by the owner in the same shift; coupon TESTCOUPON-F851F428 consumed (1/1); one shift opened 00:45 and closed 01:11 (closing 60.00, expected 67.42, discrepancy -7.42). Old PASSWORD of owner@sefay.com was reset by the owner in SQL for this test (tell the owner to change it).

### Passed
- Shift open (201). Cash sale exact and with larger tendered amount (change 21.25 correct, shown on receipt). Mada. Split cash+card. Valid coupon 10% (tax computed after discount: 25.00 - 2.50 -> VAT 3.38 -> 25.88). Expired coupon rejected (400). Double-click on Confirm created ONE invoice only. Cancel invoice (200, status cancelled, today's revenue dropped by 5.75; cancelled order excluded from shift summary - verified by SQL). Shift close stored closing 60.00 / expected 67.42 / discrepancy -7.42 correctly. Expected cash 67.42 verified by hand against SQL (45.42 cash invoices + 22.00 cash share of splits).

### Defects found (new, by runtime)
- N1 (HIGH, confirms S5): shift summary Card Sales (38.38) counts only the card share of SPLIT orders. Mada (2 invoices, 11.50) and wallet (1, 5.75) appear in no bucket: cash + card = 105.80 but Total Sales = 123.05 (gap 17.25).
- N2 (MEDIUM): closed-shift summary stays STALE in the browser after closing (showed closing 0.00 / discrepancy -67.42 until page reload; database was correct). Query cache not invalidated on close.
- N3 (MEDIUM): Close Register dialog shows only opening cash and a blank field - no expected cash, no sales summary (blind close). Summary of an OPEN shift shows "Discrepancy -67.42" in red (misleading).
- N4 (HIGH for pilot): invoice create takes 5.4-6.5 seconds each (POST /invoices) on this setup.
- N5 (MEDIUM): receipt lacks business name, tax number, cashier name, cash tendered; split payment shows only "Cash + Card" without the two amounts; in the Arabic receipt the item line and date/time render in broken order (bidi); cart item name truncated on the left in RTL.
- N6 (LOW): cancel dialog shows the full UUID instead of the short invoice number; reason is optional.
- N7 (LOW): dashboard showed Sales 0.00 right after sales while Orders page showed today's revenue 4,527.25 (stale or different source; not investigated).
- N8: Print button = browser print only (no Sunmi) - see SUNMI-PRINTING-TASKS.
- N9: the PUBLISHED stack is down: Railway trial expired (api + Redis offline) so https://sefayv1-0-2.vercel.app cannot log anyone in; Vercel rewrites /api/v1 to NEXT_PUBLIC_API_URL. Pilot needs paid/other API hosting first.
- N10 (note): SQL count of public.invoices returned 2 while the Orders page shows 50 invoices (orders table); invoices vs orders naming - not investigated.

### Not tested / not reproduced
- P2 (split + LOYALTY/reward discount): not tested (account has 0 points). P2 with a COUPON works.
- S1 race (two simultaneous shift opens): not testable from UI; sequential second open is blocked by the service.
- Card refund/void effect on expected cash (S4), cash expenses vs expected cash (S3), wallet/STC/Apple Pay/Visa flows beyond mada, partial/returns, customer selection, hold/resume order, printing on a real device, cashier role (non-owner) permissions.


<!-- POS-RUNTIME-TEST-2026-11-09-N7-RESOLVED -->
## N7 resolved (2026-11-09): dashboard/reports day boundary is UTC, not the tenant timezone (HIGH for pilot)
- Evidence (runtime): GET /reports/revenue?from=2026-11-09&to=2026-11-09 returned all zeros; the same report for 2026-11-03..2026-11-09 returned 10 orders / 123.05 with daily_breakdown date 2026-11-08. Orders were created 00:45-01:11 local (UTC+3) = 21:45-22:11 UTC of the previous day.
- Effect: sales between 00:00 and 03:00 local time show under the PREVIOUS day on the dashboard and reports; "Sales today" can read 0 right after midnight. Amounts are correct, only the day bucket is wrong. Matters for a car wash working past midnight.
- Not fixed. Needs a decision: use the tenant/branch timezone for day boundaries (reports + dashboard + shift summary), design review first if it touches schema (tenants timezone column).


<!-- TASK-T9-REGISTER-CLOSE-DESIGN-2026-11-09 -->
## Task T9 (owner order 2026-11-09): merge register + shift, close-with-counts daily report (print / PDF share), returns + cancellations figure, tenant-timezone day
- Status: ARCHITECTURE REVIEW WRITTEN, awaiting owner answers Q1-Q6 and the exact message "Approved - Proceed with Implementation". Nothing implemented.
- Full design: STATUS.md section "DESIGN-REVIEW-REGISTER-CLOSE-2026-11-09". Includes T8/S3, S1, S2, S4, S5/N1, S6, N2, N3, N7.


<!-- PHASE-1-IMPLEMENTED-2026-11-09 -->
## T9 phase 1 DONE in code (2026-11-09): N7 (tenant-timezone days) and N1/S5 (all payment methods in shift summary). Local only, tests green (124). Next phase per design: close-with-counts + report PDF/print (phase 2). Details: STATUS.md PHASE-1-IMPLEMENTED-2026-11-09.


<!-- PHASE-2-IMPLEMENTED-2026-11-09 -->
## T9 phase 2 DONE in code (2026-11-09): close with per-method counts + PDF report (print / share). Local only, tests green (135). BLOCKER for use: apply migration 251 on the live DB (`npm run migrate` in api) - the owner must run it. Also needs Chrome/Chromium + an Arabic font on whatever server hosts the API. Details: STATUS.md PHASE-2-IMPLEMENTED-2026-11-09. Next: phase 3 (cancellation fields + returns document, cancelled/returned in every report).


<!-- PHASE-3A-IMPLEMENTED-2026-11-09 -->
## T9 phase 3a DONE in code (2026-11-09): cancellation fields (who/when/why) + cancelled figure in the revenue report and order details. BLOCKER for use: apply migration 252 (`npm run migrate` in api, owner must run it). Phase 3b (partial returns document with refund, stock restock and journal entry) awaits the owner's confirmation of its accounting/stock design (see chat 2026-11-09).


<!-- PHASE-3B-IMPLEMENTED-2026-11-09 -->
## T9 phase 3b DONE in code (2026-11-09): partial sales returns (stock, journal entry, register, reports, web action). BLOCKER for use: apply migration 253 (`cd C:\Fp\api; npm run migrate`, the owner must run it). Tested on a local scratch DB, not yet on the live DB. Next: phase 4 (unique open register per cashier + atomic close function S1/S2/S6), phase 5 (T8/S3 cash expenses vs the register).


<!-- TASKS-T10-T11-2026-11-09 -->
## Two new owner orders (2026-11-09), added to the repair plan - NOT started, review mode (Execution Gate)

### T10 - Reports page: figures are wrong and disorganised (owner report)
- Owner statement: the reports page shows incorrect, badly organised figures; must be inside the repair plan.
- Already fixed by T9 (phase 1/3a/3b, local, awaiting owner review): day boundaries now use the tenant timezone, shift/report totals include every payment method, cancelled and returned figures are reported apart from revenue.
- Still unknown: WHICH figures the owner sees as wrong. First step = audit: owner supplies screenshots or the figure + expected value; compare each report endpoint (revenue, payments, shifts, expenses, tax, top items, daily reconciliation, sparklines) against the database by SQL; list every mismatch with its cause; then a design review for the fixes and a re-organised page layout. No change before that audit and the exact message "Approved - Proceed with Implementation".
- Known suspects to check first: reports that still bucket by UTC date outside the paths fixed in phase 1; revenue by payment method for split orders (counted under "split" only); returns/cancellations not netted anywhere except the new figures; dashboard "sales" vs Orders page "today's revenue" using different sources (N7 note); tax report/COGS report semantics.

### T11 - Payment methods configurable per tenant (owner request)
- Owner statement: in settings, payment methods can only be enabled or disabled; the owner decides which methods he wants and disables the ones he does not.
- Proposed design points to review (not decided): a per-tenant list of enabled methods stored with the tenant settings (cash cannot be disabled); POS payment screen shows only enabled methods; the API rejects a sale paid with a disabled method; shift close counts only enabled counted methods (cash + enabled of mada/visa/mastercard, others fold into "other"); reports/filters keep showing historical methods; default for existing tenants = all current methods enabled so nothing changes until the owner turns one off; Settings page gets a simple on/off list. Needs a schema change (tenant settings column or table) -> Architectural Audit, Database Design, Business Rules, Migration Matrix first.
- Depends on / touches: T9 phase 2 (close counts), POS PaymentModal, tenants settings API/page, invoice creation validation.



---

<!-- T10-REPORTS-AUDIT-2026-11-09 -->
## T10 - Reports audit results (2026-11-09) - AUDIT ONLY, no fix made, awaiting "Approved - Proceed with Implementation"

Method: the REAL ReportsService was run against the live database (read-only, demo tenant 9bcd3369, periods: all time, 9 Nov, 8 Nov) and every figure was compared with an independent SQL calculation on the same data. The reports page shows 13 sections (4 KPIs, revenue chart, payment methods, expenses by category, employee performance, tax summary, COGS, period comparison, branch comparison, customer churn, top customers, daily reconciliation) plus the dashboard and the Orders page KPIs.

### Verified CORRECT (no action)
- Revenue base: 113 completed orders = 60,352.01 (service = SQL); 9 Nov: 10 orders = 123.05; 8 Nov: 0. Day boundaries follow the tenant timezone (phase 1).
- Payments report totals, shifts count (47 closed), daily reconciliation cash figures for 9 Nov (opening 0, counted 60, expected 67.42, difference -7.42), 7-day sparklines (local days), period comparison arithmetic, customers list.

### HIGH - the figure is wrong or means something else
- R1 Expenses read the OLD table everywhere. Reports "total expenses", expenses by category, dashboard Net Profit and expenses KPI, daily reconciliation expenses, sparklines expenses and the register expected cash all read the legacy `expenses` table (80 approved = 139,110.00, test data) while the owner records in `expenses_v2` (35 approved: 6,310.00 before VAT, 7,127.50 with VAT; 0 rows with shift_id). Also: reports filter by created_at, v2 has expense_date (the real date); v2.payment_method has inconsistent values ('Cash' vs 'cash'); v2 has no deleted_at; whether reports use amount (ex VAT) or total_amount is undecided.
- R2 COGS is nonsense: 7,550,187 cost vs 60,352 revenue (margin -12,410%); 9 Nov shows 200,624 cost for 123.05 revenue. Cause: the report sums EVERY stock_movements row of type 'sale' regardless of reference; the table holds 1,980 such rows (14,099,259 cost) mostly reference_type 'test_sale' (items "AA72 ABC Item A (80k)", quantities 80,000/15,000) written by the automated regression specs on the live database - two of them by the full jest run of 2026-11-09 23:27 and 23:30 (see disclosure below). Returns/cancellation restocks ('sale_return') are not netted. Fix direction: count only movements whose reference is an order (and subtract their returns).
- R3 Payment-method breakdown hides cash and card inside "split": split orders are their own bucket (12 orders = 35,754.51, 59% of all revenue) in revenue, payments and daily-reconciliation reports; their parts are decomposed only in the register engine. Older split orders have NULL parts (cash_part total 25.00 / card_part 41.13 vs 35,754.51), so they cannot be decomposed at all. Cash and card totals are therefore understated. Fix direction: decompose split by its stored shares; show legacy split without parts as "split (not allocated)".
- R4 Dashboard "Net Profit" is revenue (VAT inclusive) minus the old expenses table: not a profit (no COGS, VAT counted as income).
- R5 Orders page KPI "Today's Revenue" (4,527.25 on 9 Nov while the real figure was 123.05) is the sum of whatever orders the list loaded (latest 50 across dates), not today.

### MEDIUM - figures do not add up
- R6 Employee performance omits 4 orders without a cashier (370.00): listed 59,982.01 vs revenue 60,352.01. Branch comparison omits 1 order (200.00) belonging to a deleted branch ("Branch 2 Updated"): 60,152.01 vs 60,352.01. Neither shows an "unassigned" line.
- R7 Tax section: "subtotal before tax" is before DISCOUNT: 110.00 + tax 16.05 = 126.05 but total is 123.05 (discount 3.00 not shown) on 9 Nov. Needs a discount line or a net subtotal.
- R8 "Discrepancy" has two meanings: the shifts report sums ABSOLUTE values (2,758.52 all time; 7.42 on 9 Nov) while the daily reconciliation shows the SIGNED total (-7.42 on 9 Nov; 2,514.68 signed all time). Show shortage and overage separately.
- R9 Cancelled and returned sales are not shown or netted in the older sections (revenue summary, daily reconciliation, tax, dashboard); phase 3a/3b only added figures to revenue + register report.
- R10 Data oddity: order 8a61d19f (2026-06-08) has subtotal 36 - discount 0 + tax 0 = 36 but total 31.

### LOW - organisation of the page
- R11 13 sections in one long page with no grouping and no reconciliation between sections. Proposed groups: Sales (revenue, methods, returns/cancellations, tax), Cash and registers (registers, discrepancies, daily reconciliation), Costs (expenses by category from expenses_v2, COGS), People (employees, customers, churn), Places (branches, comparison); each group with its own total that ties to the sales total.
- R12 My own phase 3b code makes the revenue report fail with "table sales_returns not found" until migration 253 is applied (it also breaks the dashboard sales card). Make that query tolerant, or apply 253 before starting the new API.

### Disclosure (owner must know)
The full jest run I executed on 2026-11-09 (twice) wrote test rows into the LIVE demo tenant through the regression specs under src/database/migrations/__tests__ (e.g. stock movements 'test_sale' 80,000 + 15,000 + ... at 23:27 and 23:30 UTC). Those specs do not clean up after themselves (1,980 such movements exist since August). I did not delete anything. Do not run the full jest suite against this database again; run focused specs only. Cleaning the test rows needs the owner's explicit approval.

### Proposed fix order (after approval)
1) R1 expenses from expenses_v2 (decide amount vs total_amount and expense_date) 2) R2 COGS source filter 3) R3 split decomposition 4) R5/R4 Orders KPI and dashboard profit 5) R6/R7/R8 reconciliation lines 6) R11 page re-organisation 7) R12 resilience. R1 also unlocks T8/S3 (cash expenses vs the register).


<!-- T10-DECISION-EXPENSES-BASIS-2026-11-09 -->
### T10 decision (owner, 2026-11-09): expenses in reports are counted BEFORE VAT (expenses_v2.amount, not total_amount). On the demo tenant that is 6,310.00 (not 7,127.50). Fixes still await the exact message "Approved - Proceed with Implementation".


<!-- T10-FIXES-IMPLEMENTED-2026-11-09 -->
## T10 DONE in code (2026-11-09): reports fixes R1-R9, R11, R12 (see STATUS.md T10-FIXES-IMPLEMENTED). Open: R10 data oddity; cleanup of automated test rows in the live demo tenant needs owner approval; register expenses (T8/S3) still reads the old expenses table. Pending owner actions: apply migration 253 (cd C:\Fp\api; npm run migrate).


<!-- PHASE-4-IMPLEMENTED-2026-11-09 -->
## T9 phase 4 DONE in code (2026-11-09): S1 unique open register, S2 register must belong to cashier+branch, S6 atomic close. BLOCKER for use: apply migrations 253 + 254 (`cd C:\Fp\api; npm run migrate`, owner). Open next: phase 5 = T8/S3 cash expenses vs the register (now possible: reports read expenses_v2); T11 payment methods per tenant; cleanup of automated test rows (owner approval).


<!-- APP-SALE-FLOW-2026-11-09 -->
## Owner spec 2026-11-09: sale flow of the cashier app (recorded, nothing implemented)
Sequence: choose product(s) -> Next -> FIELDS page (shown only when enabled; includes any enabled custom field) -> payment method -> confirm payment -> invoice -> automatic print when enabled, then back to the product list; when printing is manual: Print then back, or back without printing -> then adding an invoice comment and returning to it. Then: verify the web POS and add the features the owner may have forgotten; then a ChatGPT prompt to design the app look (written: api/docs/APP_UI_PROMPT.md).
Web POS today vs this flow:
- EXISTS: product grid and cart; checkout; customer/fields step (CustomerPickerModal: name field + enabled custom fields from the settings field definitions, shown when customer_capture_enabled; plate_number / visit_date / odometer are customer fields); payment method + confirm (cash tendered/change, split); receipt modal with print; "New Order" back to products; order note typed in the cart BEFORE payment.
- MISSING: automatic print (Settings stores printer_settings.auto_print but nothing reads it = printing tasks T1-T3); a comment on an invoice AFTER the sale (no endpoint; Orders "Edit" is a disabled placeholder; needs a small design: notes are non-financial so editable, with audit); payment methods on/off per tenant (T11); the vehicle plate is saved on the CUSTOMER only, not on the invoice, so the receipt/orders cannot show which car was washed.
- NOT YET TESTED at runtime in this session: customer/fields step, hold/resume, price override/discount flow, loyalty redemption, order note, barcode scanner, tables. Tested OK: shift open, cash (with change), mada, split, coupon, double-click, cancel, close, return (SQL level).
Features proposed for a car wash that the owner may have forgotten (proposals, none approved): ZATCA tax-invoice QR on the receipt (none exists in the code; mandatory for KSA tax invoices - verify the legal requirement with the owner/accountant); plate + vehicle size on the invoice and size-based pricing; queue board (waiting/washing/ready) with "car ready" notification; worker per service line + commission; prepaid wash packages / subscriptions; account customers (companies/fleets) paid later (tab) with monthly invoice; manager PIN for discounts/price changes; quick reprint of the last invoice; WhatsApp share of the invoice; tips; hold/resume (exists in web); error states (printer out of paper, no network, payment failed); large-text and dark modes; offline mode is OUT of v1 (owner).


<!-- TASKS-T12-CUSTOMER-AUTO-RECOGNITION-2026-11-09 -->
## T12 (owner request 2026-11-09): customers saved automatically and recognised by plate or phone - DESIGN DRAFT, not started
Owner wording: a new customer is registered once with plate and phone; next time typing only the plate OR the phone finds the saved customer and nothing else needs to be completed.
Today (verified in code): customers have phone + plate_number (also as custom fields); search = partial ilike on name, phone and custom fields; duplicate phone is rejected on create (findByPhone); no exact normalised lookup; a new customer is created by a separate "quick add" step before payment, not automatically with the sale; the plate is on the customer only, not on the order/invoice.
Proposed (needs Architectural Audit / DB design / approval): one smart box (plate or phone) -> instant match card (name, plate, visit count, last visit) -> confirm; new customer saved automatically when the sale is confirmed; normalised matching (phone digits only incl. Arabic-Indic digits and leading zero; plate without spaces/dashes and case); plate (and vehicle size) stored on each order so invoice and visit reports show the car; if the plate matches customer A and the phone customer B show both, never auto-merge. Proposed data: customer_vehicles (customer_id, plate, plate_normalized, size, model) so one customer can have several cars, phone_normalized on customers with a unique-per-tenant index, orders.vehicle_id/plate snapshot. Open questions to the owner: (1) several cars per customer? (recommended yes) (2) before or after phase 5 (T8)? Same API serves web POS and the app.


<!-- T12-OWNER-DECISION-2026-11-09 -->
### T12 owner decision (2026-11-09): NO duplicates - one customer per phone AND one customer per plate
The plate and the phone can never belong to two different customers (that would be a duplicate customer): both are UNIQUE per tenant (normalised). Entering a phone of customer A with a plate of customer B is rejected as a data error (no merge, no second customer). The earlier customer_vehicles idea is dropped: one customer = one phone + one plate. Consequence to tell the owner: a person with a second car cannot be saved with the same phone (register that car without a phone, or decide later). Live data check (read-only, 2026-11-09): 57 customers, 5 with phone, 1 with plate, no duplicate phone or plate (digits-only / space-and-case-insensitive) so the unique indexes can be created safely. Matching rule: phone = last 9 digits (covers 05..., 5..., +9665..., Arabic-Indic digits); plate = no spaces/dashes, case-insensitive. Awaiting: before or after phase 5; then design review + "Approved - Proceed with Implementation".


<!-- T12-OWNER-DECISION-2-2026-11-09 -->
### T12 owner decision 2 (2026-11-09) - supersedes the "one plate per customer" part above
One customer = ONE phone (unique per tenant) but ANY number of cars (1, 2, 3 ...), all under the same customer data. Each PLATE is unique per tenant and belongs to exactly one customer (a plate can never exist under two customers: that is a duplicate). So the customer_vehicles table is BACK: customer_vehicles(customer_id, plate, plate_normalized UNIQUE per tenant, size, model, deleted_at). Lookup: by plate -> the customer + that car; by phone -> the customer + the list of his cars to pick from (one car = automatic); a phone of customer A with a plate of customer B is rejected as a data error (no merge). A new car for an existing customer is added with his phone (or by his existing plate) without creating a second customer. The sale stores which car was washed (orders.vehicle_id + plate snapshot). Existing customers.plate_number values migrate into customer_vehicles. Still awaiting: before or after phase 5; then design review + "Approved - Proceed with Implementation".


<!-- TASKS-T13-INVOICE-AND-KITCHEN-TICKET-DESIGNER-2026-11-09 -->
## T13 (owner request 2026-11-09): invoice customisation page + kitchen ticket (button + customisation page) - DESIGN DRAFT, not started
Owner wording: fields so the merchant can add his logo; tax number NOT mandatory; the other business details too; a dedicated page to edit and customise the invoice; a "kitchen printer" button; a page to edit and customise the kitchen ticket.
Today (verified in code): tenants already store logo_url, tax_number, invoice_footer, address, phone, email and printer_settings (paper width, auto_print); the Settings page edits them, but the logo is a plain URL text box (no upload; a StorageService exists in the API), and the receipt shown/printed at the POS (ReceiptModal) uses NONE of them (no logo, no tax number, no business name, no footer). There is a Kitchen screen (KDS) and order_items.kitchen_status, but no kitchen ticket printing and no kitchen printer setting.
Proposed (design review needed, schema change): (1) Invoice designer page in Settings: logo upload (storage bucket, size/format limit), business name, address, phone, optional tax number (shown only when filled), optional commercial register, footer text, QR toggle (ZATCA QR when the owner confirms it is required), paper width 58/80/A4, which blocks to show or hide and their order (vehicle plate, cashier, worker, notes, payment lines), live preview that is the SAME renderer used for printing (web print CSS, Sunmi, PDF); (2) kitchen ticket designer with its own template (header, order number, table/car, items with quantities and notes, hide prices, font size, copies) and a "Kitchen" print button on the order/cart that prints only new items to the kitchen printer; (3) printer settings per device and per ticket type (customer invoice / kitchen), auto-print per type. Storage proposal: tenants.invoice_template jsonb + tenants.kitchen_template jsonb (default = today's look, so nothing changes until the owner edits). Depends on: printing tasks T1-T4 (one printReceipt() renderer for invoice and kitchen), phase 5 first, T11 and T12 ordering still to confirm. Questions: (a) is the kitchen ticket needed for the car-wash pilot or only for restaurant tenants? (b) should the logo also appear on the PDF close report? (c) one template per tenant or per branch?


<!-- T13-OWNER-ANSWERS-2026-11-09 -->
### T13 owner answers (2026-11-09)
- Kitchen ticket (button + customisation page): NOT needed for the car-wash pilot, but it must be documented and implemented later (restaurant tenants). Scheduled after the pilot-critical work; same printing renderer as the invoice.
- Template scope: ONE template per tenant (default), with an OPTIONAL per-branch override (branch template wins when set). Data: tenants.invoice_template / kitchen_template (jsonb) + branches.invoice_template / kitchen_template (nullable jsonb override).
- The register-close report PDF shows the SaaS platform logo (Sefay), NOT the merchant's logo. (The merchant logo is for the customer invoice and the kitchen ticket.) The report template (api/src/modules/shifts/report) gets a Sefay logo header when the identity is final.


<!-- APP-UI-IDENTITY-REVIEW-2026-11-09 -->
## App UI identity (ChatGPT boards received 2026-11-09, 8 images) - review recorded
Accepted as the visual direction (pending owner "lock"): navy #0C447C + teal accent (buttons use a darker teal for contrast), background #F5F7FA, semantic green/amber/red/blue, dark mode #0B1220/#111A2E, Arabic font Cairo, radius 12/16/pill, rounded line icons, Sefay wordmark + car-and-drop mark, Sunmi frame, status badges (waiting, washing, ready, completed, cancelled, returned), bottom nav (Sale, Queue, Orders, Customers, More), tablet layout with cart on the left.
Screens delivered: design system sheet; entry (splash, login, branch, no register, open register); sale (service grid, fields page, discount with manager PIN, payment, split, invoice + print/note, print failed); orders, returns, register close + report, error states; customers (list, profile with cars, add car); reports (today, by payment method, by worker); more/settings (printer, language, theme, payment methods toggles, account); dark mode set; tablet sale screen.
Corrections to ask for / design notes: (1) the data-conflict screen offers "register as a NEW customer for this plate" = a duplicate; per owner decision T12 only: use the registered customer, or go back and correct (a phone change only by a manager); (2) the fields page shows plate and phone as two plain fields: the smart lookup (type plate OR phone -> instant match card, several cars -> pick the car) is not drawn; (3) missing screens: queue board / car details / assign worker / ready notification, order details, cancel dialog, register history, cash drawer, test print + invoice designer entry in Settings, receipt with ZATCA QR when required; (4) mock numbers are inconsistent (VAT shown as 1% in one screen, dates 2025-01-26): never copy numbers from the images; (5) first-batch sale screens used English words (Next, Confirm payment): the later boards are fully Arabic and are the reference.


<!-- APP-UI-IDENTITY-FINAL-BATCH-2026-11-09 -->
## App UI identity - final batch reviewed (2026-11-09): identity READY TO LOCK (owner word pending)
Final boards (3 images) close the gaps: smart customer lookup with 6 states (empty, typing, found, several cars -> pick one, not found -> create with plate + phone + size, data conflict with ONLY "use the registered customer" / "back to correct": matches the T12 no-duplicate decision); queue board + car details with status stepper + assign worker (available/busy/unavailable) + "car ready" notification + order details with returns + cancel dialog with a reason list; register history, open cash drawer, blind-count close, printer settings with test print, invoice designer (logo upload, business name, OPTIONAL tax number, footer, paper width, design/content tabs) and receipt preview with QR (T13).
Non-blocking notes: mock numbers/dates are placeholders; register history shows closed registers' amounts (decide who may see it: manager only?); the QR must only appear when the owner confirms the legal requirement; blind-count screen shows entered values, never expected ones.
Next decisions (not yet made): (1) owner locks the identity; (2) app technology: still the assistant's RECOMMENDATION native Android Kotlin + Jetpack Compose (strongest for Sunmi, official SDK is native; backend stays the source of truth) vs the older documented plan pos_m React Native + Expo; owner has not confirmed; (3) then the app architecture review (8-point Application/Mobile rule) and the list of backend endpoints the app needs (auth, shifts, items/services, orders, returns, customer lookup T12, printing, queue).


<!-- APP-DECISIONS-LOCKED-2026-11-09 -->
## Owner decisions 2026-11-09: app identity LOCKED and technology CONFIRMED
- Visual identity locked (boards received 2026-11-09, see APP-UI-IDENTITY-*): navy #0C447C + teal, Cairo, locked component set, Sefay mark, Sunmi frame, tablet layout.
- Technology confirmed: NATIVE ANDROID, Kotlin + Jetpack Compose. Supersedes the older plan pos_m (React Native + Expo + WebView) for this app. iPhone later (Kotlin Multiplatform or Swift), backend remains the source of truth.
- Architecture review written: api/docs/APP_ARCHITECTURE_REVIEW.md (stack, 8-point check per capability, backend gaps G1-G9, build order, risks). Nothing built; awaiting the exact approval message for each backend gap that touches the schema.
- Key finding: the web auth returns the refresh token only as an httpOnly cookie (G1); native clients need a token-based mode before the app can log in.


<!-- APP-DESIGN-REFERENCE-FOLDER-2026-11-09 -->
## App design reference folder (2026-11-09)
Locked identity images are saved in C:\Fp\sefay-app-design\ (README.md = index, rules, tokens): final/ = 10 locked boards, earlier-iterations/ = 4 older boards kept because the RETURN ITEMS, close report and orders-list screens were not redrawn later (one of them is marked superseded for its English labels). 14 of the 15 images received were saved; image 23 was byte-identical to image 18 (MD5 verified) so it was not duplicated. The very first mock-up (reviewed days earlier) is not stored. Rule: the images are the LOOK only; behaviour comes from the decisions in this file (T9, T11, T12, T13, APP-SALE-FLOW). Do not copy numbers or dates from the pictures.

<!-- WASH-QUEUE-2026-11-09 -->
## Wash queue (G5) and car-ready hook (G9) - done 2026-11-09
- [x] Migration 256 + module `wash-queue` + web `/dashboard/queue` + `CarReadyNotifier` (log implementation). Details in STATUS.md (WASH-QUEUE-2026-11-09).
- [ ] Owner: apply migration 256 (`cd C:\Fp\api; npm run migrate`).
- [ ] Later (undecided): real car-ready channel (SMS/WhatsApp/push) and customer consent; auto-create a wash job from a POS sale.


<!-- PRINT-TEMPLATES-2026-11-09 -->
## T13 + printing T1-T3 - implemented 2026-11-09 (web first; the Android app reuses the same `/print/*` payload)

| Item | Status |
|---|---|
| T13 invoice designer page (logo upload, business details, optional tax number, footer, paper, blocks, QR, per-branch override, live preview) | done, type-checked, NOT run in a browser |
| T13 kitchen ticket designer page + Kitchen print button | done (button on receipt and order details; none on the pre-payment cart: needs a saved order) |
| Migration 257 (tenant + branch templates) | written and verified on a scratch DB; owner must run `cd C:\Fp\api; npm run migrate` |
| T1 receipt template + print CSS 58/80 mm/A4 | done (single renderer) |
| T2 single printReceipt(), Sunmi driver -> browser fallback | done; Sunmi driver UNVERIFIED on a device, off by default |
| T3 printer settings real (auto_print, paper width), reprint from Orders | done (auto_print read from the print payload; paper width from template, falling back to printer_settings) |
| T4 owner test on a real Sunmi device (Arabic, silent print, ws://localhost:7070 from https) | still owner action |
| ZATCA QR legal confirmation | owner/accountant action; QR is off by default and needs a tax number |
Details and verification: STATUS.md section PRINT-TEMPLATES-2026-11-09.


<!-- INVOICE-CUSTOMERS-2026-11-09 -->
## Invoice / customers batch (2026-11-09) - T12 customer auto-recognition, G4 worker commission, G6 invoice note, T11/G8 payment methods per tenant

Owner approval "Approved - Proceed with Implementation" (2026-11-09). NOT committed. **BLOCKER for use: migration 255 must be applied by the owner with `cd C:\Fp\api; npm run migrate`** (the code reads/writes the new columns; without it sales fail). Nothing was written to the live database.

### What was built
- Migration `255_customer_vehicles_worker_commission_payment_methods.sql`: `fn_normalize_phone` (digits only, last 9, Arabic-Indic and Persian digits mapped) and `fn_normalize_plate` (no spaces/dashes/underscores/dots, upper-case); `customers.phone_normalized` (trigger-maintained, UNIQUE per tenant where not null and not deleted); table `customer_vehicles` (tenant_id, customer_id, plate, plate_normalized UNIQUE per tenant where not deleted, size, model, colour, deleted_at, RLS policy, service_role GRANT); `customers.plate_number` migrated into it; `orders.vehicle_id / plate_snapshot / vehicle_size`; `order_items.worker_id / commission_rate / commission_amount`; `tenants.enabled_payment_methods` jsonb (default = all 10 current methods, CHECK: must be an array containing 'cash').
- T12 API: `GET /customers/lookup?plate=&phone=` (permission customers.view; NOT limited by Customer Scope so a plate/phone is recognised at every branch), `GET/POST /customers/:id/vehicles`; invoice DTO accepts `customer_capture {phone, plate, size, name, custom_fields}` resolved server-side BEFORE loyalty/rewards (`CustomersService.resolveCapture`); idempotent (same phone/plate always resolves to the same rows, plus the existing sale_attempt_id check); phone of A + plate of B = 409 `customer_capture_conflict` (names of both customers in the body), no merge; a plate owned by another customer = 409 `plate_already_registered`; `orders.vehicle_id/plate_snapshot/vehicle_size` stored in both write paths (pooled and PostgREST) and returned by GET /invoices. The existing customer create form now also rejects a duplicate plate (409) and registers the plate as the first car; the old phone duplicate check now matches on the normalised phone.
- G4: `worker_id` per invoice line; rate read server-side from `users.commission_rate` (active user of the tenant, otherwise 400 `invalid_worker`); `commission_amount = unit_price x quantity x rate` at the final server price, before invoice discount/tax; client-sent rates are ignored; fields exposed on GET /invoices/:id items. No report was changed.
- G6: `PATCH /invoices/:id/note {note}` (permission `invoice.create`), edits only `orders.notes`, completed invoices allowed, empty text clears it, audited as `invoice.note` with before/after.
- T11/G8: `GET /tenant/pos-config` returns `enabled_payment_methods`; `PATCH /tenant/profile` accepts it (400 if 'cash' missing); invoice create rejects a disabled method with 400 `payment_method_disabled` before any side effect ('cash' is never checked). 'split' is treated as its own method (owner can switch it off).
- Web: `CustomerPickerModal` = ONE smart box (digits-only 7+ => phone, otherwise plate; 350 ms debounce; found => match card with visits / last visit / total spent and a car picker when there are several; not found => name search fallback + create form with phone, plate, size chips and the remaining custom fields; conflict => only "use the registered customer" (the plate owner) or "back to correct"); POSPage sends `customer_capture` and `worker_id`; CartPanel has a worker select per line (active users from `GET /users`; a role without access simply gets no picker); `PaymentModal` shows only enabled methods; Settings has on/off switches (cash locked on); `InvoiceNoteEditor` ("Add invoice note") on the receipt modal and on the order details modal (completed orders). All new text in `web/messages/{en,ar}/pos.json` and `settings.json`; numbers English digits.

### Verified
- SQL on a LOCAL scratch Postgres `sefay_inv_test` (all migrations 001-255 applied; 073/074 fail on the missing `auth` schema as expected): normalisation (+966 / 05 / Arabic-Indic / Persian digits => same 9 digits; plate `abc - 1234` => `ABC1234`), one customer with 2 cars, duplicate phone (different format) rejected, duplicate plate (other customer) rejected, soft-deleted plate reusable, 'cash' cannot be removed from enabled_payment_methods, orders + order_items with the new columns insert correctly. Database dropped afterwards.
- Jest (focused only): `customer-recognition.spec.ts` (normalisation, lookup, resolveCapture idempotency / conflict / add car / race), `invoices-customers-workers.spec.ts` (disabled method 400, cash always allowed, capture => vehicle on the order in both write paths, 409 creates no order, commission snapshot both paths, invalid worker 400, note audited / cleared / 404). `npx jest src/modules/invoices src/modules/customers src/modules/tenants` = 6 suites, 102 tests pass. `npx tsc --noEmit` clean in api and web.

### NOT verified / open
- No end-to-end run against the live database or a browser (migration 255 not applied there; the new web screens were type-checked only, not clicked).
- Vehicle size options (small / medium / large / extra large) are an assumption, stored as free text; the owner can change the list.
- On a conflict the web offers the plate owner as "the registered customer" (the car being washed decides); the typed phone is dropped.
- `GET /users` requires users access: a cashier role without it sees no worker picker (backend accepts worker_id regardless). Decide if a dedicated "workers" list endpoint is wanted.
- The ReceiptModal / print layouts do not yet print the plate or the worker (print templates belong to the print-templates session).
- TODO (T11, not touched: `src/modules/shifts/**` and `src/engines/shift-engine/**` belong to another session): register-close counted methods must follow `tenants.enabled_payment_methods` (cash + enabled of mada/visa/mastercard, others fold into "other"), and reports keep showing historical methods.
- TODO (T12): customers module "edit customer" screen does not yet list/add cars (API exists: `GET/POST /customers/:id/vehicles`); a person with a second car is added through the smart box with the same phone + the new plate.


<!-- PHASE-5-G1-INTEGRATION-2026-11-10 -->
## Remaining after this round (2026-11-10)
1) OWNER: apply migrations 255 + 256 + 257 (`cd C:\Fp\api; npm run migrate`), restart the api, start Redis (redis-local). 2) Test in the browser: invoice designer + kitchen designer, auto-print, smart customer box, worker per line, invoice note, payment methods switches, queue board, expense "paid from register". 3) Test printing on the real Sunmi device (Arabic, 58 mm, silent auto-print). 4) Confirm ZATCA QR requirement and create the storage bucket for logos. 5) Register-close counted methods should follow the enabled payment methods (T11 follow-up, shifts files). 6) POS -> wash job link and worker name on the receipt (queue + invoice sessions notes). 7) Android: wire the real API (G1 done, other contracts exist) after the owner reviews the UI on a device; Sunmi printer SDK; emulator/real device run. 8) Cleanup of automated test rows in the live demo tenant (owner approval). 9) R10 data oddity, commit/push decisions (owner).
