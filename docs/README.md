# Sefay API — v1.0.2

نظام إدارة نقاط البيع والمخزون والفواتير متعدد المستأجرين (Multi-Tenant SaaS).

---

## التقنيات

| الطبقة | التقنية |
|---|---|
| Framework | NestJS v11 |
| Database | Supabase (PostgreSQL + PostgREST) |
| Cache / Queue | Redis (ioredis) |
| Queue Workers | BullMQ |
| Auth | JWT (jsonwebtoken) — بدون Passport |
| Rate Limiting | @nestjs/throttler مع Redis backend |
| Scheduler | @nestjs/schedule |

---

## هيكل المشروع

```
src/
├── core/                    # بنية تحتية مشتركة (global)
│   ├── ai-usage/            # تتبع استخدام AI
│   ├── audit/               # سجل العمليات
│   ├── auth/                # JWT guard
│   ├── billing/             # الفوترة
│   ├── cache/               # Redis cache
│   ├── feature-flags/       # تحكم بالميزات
│   ├── logger/              # نظام اللوج المنظّم
│   ├── metrics/             # مؤشرات الأداء
│   ├── notification/        # إشعارات داخلية
│   ├── outbox/              # Outbox pattern للأحداث
│   ├── perf/                # قياس أداء الطلبات
│   ├── permissions/         # نظام الصلاحيات
│   ├── queue/               # BullMQ queues
│   ├── security/            # Throttler + IP middleware
│   └── tenant/              # Tenant isolation
├── modules/                 # وحدات الأعمال
│   ├── auth/                # تسجيل دخول وجلسات
│   ├── branches/            # الفروع
│   ├── customers/           # العملاء
│   ├── expenses/            # المصروفات
│   ├── inventory/           # المخزون
│   ├── invoices/            # الفواتير (orders)
│   ├── items/               # المنتجات
│   ├── notifications/       # إشعارات المستخدمين
│   ├── payments/            # المدفوعات
│   ├── plans/               # خطط الاشتراك
│   ├── purchasing/          # المشتريات
│   ├── reports/             # التقارير
│   ├── shifts/              # الورديات
│   ├── subscriptions/       # الاشتراكات
│   ├── superadmin/          # لوحة السوبر أدمن
│   ├── tenants/             # المستأجرين
│   └── users/               # المستخدمين
├── shared/                  # مشترك بين كل الوحدات
│   ├── dto/                 # PaginationDto
│   ├── supabase/            # Supabase client
│   └── types/               # JWT payload types
└── database/
    ├── migrations/          # SQL migrations (001 → 038)
    └── seeds/               # بيانات ابتدائية
```

---

## متطلبات التشغيل

```env
# مطلوب
JWT_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=                   # أو REDIS_HOST + REDIS_PORT + REDIS_PASSWORD

# اختياري
APP_ENV=production           # أو staging
JWT_EXPIRES_IN=15m
PORT=3000
```

---

## تشغيل المشروع

```bash
npm install
npm run start:dev     # development
npm run start:prod    # production
npm run build         # build
```

---

## تشغيل الـ Migrations

```bash
npx ts-node src/database/migrate.ts
```
