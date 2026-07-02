# Database Migrations

## Rules
- كل migration له rollback script مقابل
- لا hard delete على financial tables (orders, shifts, expenses)
- كل migration يُشغَّل يدوياً في Supabase SQL Editor
- اختبار على dev أولاً — ثم production

## How to Run
1. افتح Supabase Dashboard → SQL Editor
2. انسخ محتوى ملف الـ migration
3. شغّله
4. تحقق من الـ Verify query في نهاية الملف

## Migration History
| File | Status | Date |
|---|---|---|
| C0_add_shift_id_to_orders.sql | ⬜ Pending | 2026-05-28 |