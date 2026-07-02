# API Reference — Sefay

Base URL: `https://your-domain.com`

كل الطلبات (عدا `/auth/login` و `/auth/register`) تحتاج:
```
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_uuid>      ← مطلوب لغير السوبر أدمن
```

---

## Auth — `/auth`

> Rate limit: **10 طلبات / 60 ثانية** لكل IP

| Method | Endpoint | الوصف |
|---|---|---|
| POST | `/auth/login` | تسجيل دخول |
| POST | `/auth/register` | تسجيل حساب جديد |
| POST | `/auth/refresh` | تجديد access token من cookie |
| POST | `/auth/logout` | تسجيل خروج + حذف cookie |
| GET | `/auth/sessions` | قائمة الجلسات النشطة |
| POST | `/auth/sessions/revoke` | إلغاء جلسة معينة |

### POST `/auth/login`
```json
// Body
{ "email": "user@example.com", "password": "..." }

// Response 200
{
  "access_token": "eyJ...",
  "user": { "id": "...", "email": "...", "role": "owner", "tenant_id": "..." }
}
// + Sets httpOnly cookie: sefay_refresh
```

---

## Users — `/users`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/users` | `users.view` |
| GET | `/users/:id` | `users.view` |
| POST | `/users` | `users.create` |
| PATCH | `/users/:id` | `users.update` |
| DELETE | `/users/:id` | `users.delete` |

---

## Branches — `/branches`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/branches` | `branches.view` |
| POST | `/branches` | `branches.create` |
| PATCH | `/branches/:id` | `branches.update` |
| DELETE | `/branches/:id` | `branches.delete` |

---

## Items — `/items`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/items` | `items.view` |
| GET | `/items/:id` | `items.view` |
| POST | `/items` | `items.create` |
| PATCH | `/items/:id` | `items.update` |
| DELETE | `/items/:id` | `items.delete` |

---

## Invoices — `/invoices`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/invoices` | `invoices.view` |
| GET | `/invoices/:id` | `invoices.view` |
| POST | `/invoices` | `invoices.create` |
| POST | `/invoices/:id/cancel` | `invoices.cancel` |

### Query Params — GET `/invoices`
| Param | النوع | الوصف |
|---|---|---|
| `page` | number | رقم الصفحة (default: 1) |
| `per_page` | number | عدد النتائج (default: 50, max: 100) |
| `branch_id` | UUID | فلتر بالفرع |
| `status` | string | `pending`, `completed`, `cancelled` |
| `date_from` | ISO date | من تاريخ |
| `date_to` | ISO date | إلى تاريخ |

---

## Customers — `/customers`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/customers` | `customers.view` |
| GET | `/customers/:id` | `customers.view` |
| GET | `/customers/:id/stats` | `customers.view` |
| POST | `/customers` | `customers.create` |
| PATCH | `/customers/:id` | `customers.update` |
| DELETE | `/customers/:id` | `customers.delete` |

### GET `/customers/:id/stats`
```json
{
  "orders_count": 12,
  "total_spent": 4500.00,
  "avg_order": 375,
  "last_order_at": "2025-06-15T10:30:00Z"
}
```

---

## Expenses — `/expenses`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/expenses/stats` | `expenses.view` |
| GET | `/expenses` | `expenses.view` |
| GET | `/expenses/:id` | `expenses.view` |
| POST | `/expenses` | `expenses.create` |
| PATCH | `/expenses/:id/approve` | `expenses.approve` |
| PATCH | `/expenses/:id/reject` | `expenses.approve` |

### Query Params — GET `/expenses`
| Param | النوع | الوصف |
|---|---|---|
| `page` | number | رقم الصفحة (default: 1) |
| `per_page` | number | عدد النتائج (default: 50, max: 100) |
| `branch_id` | UUID | فلتر بالفرع |
| `status` | string | `pending`, `approved`, `rejected`, `expired` |
| `from` | ISO date | من تاريخ |
| `to` | ISO date | إلى تاريخ |

---

## Inventory — `/inventory`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/inventory/stock` | `inventory.view` |
| GET | `/inventory/adjustments` | `inventory.view` |
| POST | `/inventory/adjustments` | `inventory.adjust` |
| GET | `/inventory/transfers` | `inventory.view` |
| POST | `/inventory/transfers` | `inventory.transfer` |
| GET | `/inventory/counts` | `inventory.view` |
| POST | `/inventory/counts` | `inventory.count` |

---

## Purchasing — `/purchasing`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/purchasing/orders` | `purchasing.view` |
| GET | `/purchasing/orders/:id` | `purchasing.view` |
| POST | `/purchasing/orders` | `purchasing.create` |
| PATCH | `/purchasing/orders/:id/receive` | `purchasing.receive` |
| DELETE | `/purchasing/orders/:id` | `purchasing.delete` |

---

## Shifts — `/shifts`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/shifts` | `shifts.view` |
| GET | `/shifts/active` | `shifts.view` |
| POST | `/shifts/open` | `shifts.manage` |
| POST | `/shifts/:id/close` | `shifts.manage` |

---

## Reports — `/reports`

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/reports/revenue` | `reports.view` |
| GET | `/reports/expenses` | `reports.view` |
| GET | `/reports/inventory` | `reports.view` |

---

## Notifications — `/notifications`

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/notifications` | إشعارات المستخدم الحالي |
| PATCH | `/notifications/:id/read` | تحديد كمقروء |
| PATCH | `/notifications/read-all` | تحديد الكل كمقروء |

---

## Payments — `/payments`

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/payments` | قائمة المدفوعات |
| POST | `/payments` | تسجيل دفعة |

---

## Plans & Subscriptions

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/plans` | قائمة الخطط |
| GET | `/subscriptions/current` | الاشتراك الحالي |

---

## Superadmin — `/superadmin`

> يتطلب `role: superadmin` + `X-Tenant-ID` غير مطلوب

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/superadmin/analytics` | إحصائيات المنصة |
| GET | `/superadmin/analytics/usage` | استخدام كل مستأجر |
| GET | `/superadmin/analytics/revenue` | تقرير الإيرادات |
| GET | `/superadmin/analytics/mrr` | MRR |
| GET | `/superadmin/analytics/cohort` | تحليل الـ Cohort |
| GET | `/superadmin/tenants` | قائمة المستأجرين |
| GET | `/superadmin/audit-logs` | سجل العمليات |
| GET | `/superadmin/health` | صحة النظام |

---

## Internal — `/internal`

> للاستخدام الداخلي فقط

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/internal/ai-usage` | إحصائيات استخدام AI |
| GET | `/internal/ai-usage?tenant_id=X` | تصفية بمستأجر محدد |

---

## صيغة الأخطاء

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

| Code | المعنى |
|---|---|
| 400 | بيانات خاطئة |
| 401 | token غير صالح أو منتهي |
| 403 | لا صلاحية |
| 404 | العنصر غير موجود |
| 429 | تجاوز حد الطلبات |
| 500 | خطأ داخلي |
