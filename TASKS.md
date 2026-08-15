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