# Database Migrations

## How migrations actually run (automatic, via Railway)
Every deploy runs `npm run start:prod`, which is
`node dist/database/migrate.js && ... && node dist/main` (see `package.json`
and `railway.json`). `migrate.ts` tracks applied files in a real
`schema_migrations` table (filename + applied_at), diffs that against
everything in `src/database/migrations/*.sql`, and applies only the new
(pending) files, in filename order, via the Supabase Management API
(`SUPABASE_ACCESS_TOKEN`). **Just pushing a new migration file to `main` and
deploying is enough** — no manual SQL Editor step is needed in normal
operation. Confirm it actually ran via Railway's deploy logs (look for
`✅ Applied: <filename>`) or by checking the affected endpoint's behavior.

Manual `Supabase Dashboard → SQL Editor` execution is a fallback only —
useful for local/dev testing a migration before committing it, or recovering
if a deploy's automatic run fails partway through.

## Rules
- كل migration له rollback script مقابل
- لا hard delete على financial tables (orders, shifts, expenses)
- اختبار على dev أولاً — ثم production

## Migration History
| File | Status | Date |
|---|---|---|
| C0_add_shift_id_to_orders.sql | ⬜ Pending | 2026-05-28 |
