# Database — Sefay

---

## ⚠️ قاعدة إلزامية — كل migration تُنشئ جدولًا جديدًا يجب أن تمنح صلاحيات `service_role` بنفس الملف

`service_role` (المستخدَم بكل استعلامات الـAPI عبر Supabase client) **لا يحصل تلقائيًا** على صلاحيات أي جدول جديد يُنشَأ عبر SQL خام (كما تُطبَّق كل migrations هذا المشروع) — يجب `GRANT ALL ON public.<table> TO service_role;` صريحًا **داخل نفس ملف الـmigration** الذي ينشئ الجدول، وليس كخطوة لاحقة منفصلة يُعتمَد فيها على التذكّر.

**هذا حصل 3 مرات بنفس السبب بالضبط** (STATUS.md §48، §68، §71) — في كل مرة، migration جديدة تُنشئ جدولًا، تُنسى منها الـGRANT، ولا يظهر الخلل إلا عند أول استعلام فعلي على ذلك الجدول (أحيانًا بعد أيام من تطبيق الـmigration، إذا لم يُختبَر الجدول فورًا). الخطأ الناتج: `42501 permission denied for table X`، يظهر للعميل كـ500 عام بلا تفاصيل.

**قبل كتابة أي migration تُنشئ جدولًا:** أضِف `GRANT ALL ON public.<table_name> TO service_role;` بنفس الملف، فورًا بعد `CREATE TABLE`. لا تفترض أن الجدول الجديد يعمل لمجرد أن الـmigration طُبِّقت بنجاح — التحقق من الصلاحيات جزء من "التطبيق الناجح".

---

## الجداول الرئيسية

### Auth & Users
| الجدول | الوصف |
|---|---|
| `tenants` | المستأجرين (الشركات) |
| `users` | المستخدمين — مرتبطين بمستأجر |
| `device_sessions` | جلسات الأجهزة (تسجيل دخول) |
| `refresh_tokens` | Refresh tokens |

### Core Business
| الجدول | الوصف |
|---|---|
| `branches` | فروع كل مستأجر |
| `customers` | قاعدة عملاء كل مستأجر |
| `items` | المنتجات والخدمات |
| `orders` | الفواتير (invoices) |
| `order_items` | بنود الفواتير |
| `shifts` | الورديات |
| `expenses` | المصروفات |
| `expense_templates` | قوالب المصروفات المتكررة |

### Inventory
| الجدول | الوصف |
|---|---|
| `warehouses` | المستودعات |
| `warehouse_locations` | مواقع داخل المستودع |
| `stock_levels` | مستوى المخزون الحالي |
| `stock_movements` | حركات المخزون |
| `inventory_adjustments` | تسويات المخزون |
| `inventory_transfers` | تحويلات بين مستودعات |
| `inventory_counts` | جرد المخزون |
| `inventory_count_items` | بنود الجرد |

### Purchasing
| الجدول | الوصف |
|---|---|
| `suppliers` | الموردين |
| `purchase_orders` | أوامر الشراء |
| `purchase_order_items` | بنود أوامر الشراء |

### Billing & Plans
| الجدول | الوصف |
|---|---|
| `plans` | خطط الاشتراك |
| `plan_features` | الميزات المرتبطة بكل خطة |
| `subscriptions` | اشتراكات المستأجرين |
| `payments` | المدفوعات |

### System
| الجدول | الوصف |
|---|---|
| `permissions` | الصلاحيات المتاحة في النظام (كتالوج عالمي، `group_id` يربطها بـ`permission_groups`) |
| `role_permissions` | الصلاحيات **الافتراضية العالمية** لكل دور (المصدر الدائم — لا يُعدَّل، البديل عند غياب تخصيص) |
| `roles` | الأدوار كصفوف حقيقية (7 أدوار نظام `tenant_id IS NULL`؛ يدعم أدوارًا مخصصة لكل مستأجر لاحقًا — راجع STATUS.md §68) |
| `tenant_role_permissions` | تخصيص كل مستأجر لصلاحية دور واحدة (دمج، لا استبدال كامل للدور) — راجع STATUS.md §68 |
| `permission_groups` | تصنيف الصلاحيات لعرضها بالواجهة (employees/attendance/expenses/payroll/...) |
| `features` | الميزات القابلة للتفعيل |
| `audit_logs` | سجل العمليات |
| `outbox_events` | Outbox pattern |
| `notifications` | إشعارات المستخدمين |
| `field_definitions` | حقول مخصصة للعملاء |
| `customer_fields` | قيم الحقول المخصصة |
| `reorder_points` | نقاط إعادة الطلب للمخزون |
| `migrations` | جدول تتبع الـ migrations |

---

## Soft Delete

كل الجداول الرئيسية تستخدم `deleted_at TIMESTAMPTZ` بدلاً من الحذف الفعلي.

**الاستعلامات دائماً تضيف:**
```sql
WHERE deleted_at IS NULL
```

---

## Tenant Isolation

كل جدول أعمال يحتوي `tenant_id UUID NOT NULL`.

**Row Level Security (RLS):** معطّل — العزل يتم في الكود عبر `.eq('tenant_id', tenantId)`.

---

## Indexes

### Migration 035 — الأداء العام
- Orders: (tenant_id, created_at)
- Stock levels: (tenant_id, item_id)

### Migration 037 — إضافات هذه الجلسة
```sql
-- Invoices
idx_orders_tenant_status_customer  ON orders(tenant_id, status, customer_id) WHERE deleted_at IS NULL
idx_orders_tenant_branch_created   ON orders(tenant_id, branch_id, created_at DESC) WHERE deleted_at IS NULL
idx_order_items_item               ON order_items(item_id)

-- Customers (GIN trigram لـ LIKE search)
idx_customers_fullname_trgm        USING GIN (full_name gin_trgm_ops) WHERE deleted_at IS NULL
idx_customers_phone_trgm           USING GIN (phone gin_trgm_ops) WHERE deleted_at IS NULL AND phone IS NOT NULL

-- Auth sessions
idx_sessions_user_all              ON device_sessions(user_id, created_at DESC)
idx_tokens_session_used            ON refresh_tokens(session_id, is_used) WHERE is_used = false

-- Stock
idx_stock_levels_tenant_warehouse  ON stock_levels(tenant_id, warehouse_id)
idx_stock_levels_tenant_item       ON stock_levels(tenant_id, item_id)
idx_stock_movements_tenant_occurred ON stock_movements(tenant_id, occurred_at DESC)
idx_stock_movements_tenant_warehouse_occurred ON stock_movements(tenant_id, warehouse_id, occurred_at DESC)
```

---

## RPC Functions

### migration 019 — Inventory
- `fn_adjust_stock` — تسوية المخزون بشكل atomic
- `fn_transfer_stock` — تحويل بين مستودعات
- `fn_receive_purchase_order` — استلام أوامر الشراء
- `fn_commit_count` — تأكيد جرد المخزون

### migration 022 — Outbox
- `fn_claim_outbox_events` — يحجز batch من الأحداث بشكل atomic

### migration 024، 028 — Analytics
- `get_inventory_analytics` — تقارير المخزون
- `get_inventory_reports_summary` — ملخص التقارير

### migration 038 — هذه الجلسة
```sql
-- مجموع إيرادات الأوردرات المكتملة (cross-tenant)
sum_completed_orders_revenue() → NUMERIC

-- إحصائيات استخدام كل مستأجر في نطاق زمني
get_tenant_usage_analytics(p_from, p_to) → TABLE(...)

-- مجموع ما أنفقه عميل معين
customer_order_aggregates(p_tenant_id, p_customer_id) → TABLE(total_spent)
```

---

## تشغيل Migrations

```bash
# تشغيل كل الـ migrations الجديدة
npx ts-node src/database/migrate.ts
```

الـ migrator يتتبع المُطبَّق منها في جدول `migrations` ولا يُعيد تشغيل ما تم.

---

## Supabase Client

```typescript
// الاستخدام في الـ repositories
this.supabase.from('table').select('*').eq('tenant_id', tenantId)

// FK Embedding (PostgREST)
this.supabase.from('orders').select(`
  id, total,
  cashier:users!orders_cashier_id_fkey(name),
  customer:customers!orders_customer_id_fkey(full_name)
`)

// COUNT بدون بيانات
this.supabase.from('customers').select('*', { count: 'exact', head: true })

// Pagination
const [from, to] = pagination.range;  // [0, 49]
query.range(from, to)
```
