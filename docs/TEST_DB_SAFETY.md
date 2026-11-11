# Test database safety

## Why
Before 2026-11-11 every `*.regression.spec.ts` (59 specs) connected with a
service-role key read from `.env` to the app's own Supabase project (very
likely the production project, shared with staging) and wrote to it. Six specs
also picked "the first active warehouse/tenant", i.e. an arbitrary tenant.

## What changed
| Command | Runs | Database |
|---|---|---|
| `npm test` | unit specs only (no spec that contains `createClient(` / `SUPABASE_*` / `DATABASE_URL`) | none |
| `npm run test:integration` | the 59 DB-backed specs | only an isolated, allow-listed Supabase test project |

`npm run test:integration` aborts in `globalSetup` — before any spec loads and
before any client exists — unless ALL hold:

1. `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_TENANT_ID` are set;
2. the project ref in `TEST_SUPABASE_URL` is listed in
   `test/support/allowed-test-projects.json` (empty by default);
3. that ref is NOT any database the app itself is configured with
   (`SUPABASE_URL` / `DATABASE_URL` in the environment or in `.env*` files,
   plus `PROTECTED_SUPABASE_REFS`);
4. `ALLOW_DB_WRITE_TESTS` equals that exact ref.

Per worker, `test/support/integration-setup.ts` re-points `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` to the TEST_* values (or blank) so a
spec's own `import 'dotenv/config'` can never pull the real `.env`, and wraps
`createClient` in a guard that re-validates the project and refuses:
insert/upsert/update with a foreign `tenant_id`, rpc with a foreign
`p_tenant_id`, and update/delete with no filter. Runs are serial (`maxWorkers: 1`).

Specs no longer choose a tenant/warehouse themselves: use
`requireTestTenantId()` / `pickTestWarehouse()` from `test/support/test-tenant.ts`.
A unit spec (`db-spec-classification.spec.ts`) fails the build if a DB spec
picks "the first" tenant/warehouse without a tenant filter.

## To enable integration tests (owner action)
1. Create a dedicated Supabase project for tests; apply all migrations to it.
2. Seed a test tenant (53 specs expect the QA tenant id they hard-code — seed
   that id) with one active warehouse; set `TEST_TENANT_ID` to it.
3. Add the project ref to `allowed-test-projects.json`.
4. Run (values from your secret store, never committed):
   `TEST_SUPABASE_URL=… TEST_SUPABASE_SERVICE_ROLE_KEY=… TEST_TENANT_ID=… ALLOW_DB_WRITE_TESTS=<ref> npm run test:integration`

## Not covered
- `test/app.e2e-spec.ts` (`npm run test:e2e`) boots the real AppModule with
  `.env`; not changed here.
- Ad-hoc scripts (`setup_qa_users.js`, `scripts/qa-*.js`, `test.js`, seeds) use
  the real `.env` by design and are not Jest.

---

# Incident investigation plan (READ-ONLY; nothing here has been executed)

Needs owner approval before any live query. Use a read-only role or run
`SELECT` only; never `DELETE`/`UPDATE`; take a backup/PITR snapshot first;
export results to a file instead of cleaning anything.

Markers (fixture item names, created by the six specs and others named `QA …`):
`QA I2 Zero-Qty Backorder Test Item`, `QA I3 Multi-Layer FIFO Test Item`,
`QA I4 Goods Receipt Reversal Item`, `QA I4 Consumed-Before-Reversal Item`,
`QA I5 Reservation Test Item`, `QA 2b Packaging Wiring Item`,
`QA Item#2 Packaging Test Item` (+ attribute `QA Color`).

```sql
-- 1) Which tenant(s) received fixtures, and when
SELECT tenant_id, name, created_at, deleted_at, is_active
FROM items
WHERE name LIKE 'QA I_ %' OR name LIKE 'QA 2b %' OR name LIKE 'QA Item#2 %'
ORDER BY created_at DESC;

-- 2) Permanent ledger residue for those items
SELECT m.tenant_id, m.item_id, m.warehouse_id, m.movement_type, m.quantity, m.created_at
FROM stock_movements m
WHERE m.item_id IN (SELECT id FROM items
  WHERE name LIKE 'QA I_ %' OR name LIKE 'QA 2b %' OR name LIKE 'QA Item#2 %')
ORDER BY m.created_at;

-- 3) Orphaned fixture rows (should be empty if cleanup ran)
SELECT 'stock_levels', count(*) FROM stock_levels WHERE item_id IN (<ids from 1>)
UNION ALL SELECT 'cost_layers', count(*) FROM cost_layers WHERE item_id IN (<ids>)
UNION ALL SELECT 'item_batches', count(*) FROM item_batches WHERE item_id IN (<ids>)
UNION ALL SELECT 'item_serials', count(*) FROM item_serials WHERE item_id IN (<ids>)
UNION ALL SELECT 'stock_reservations', count(*) FROM stock_reservations WHERE item_id IN (<ids>)
UNION ALL SELECT 'backorders', count(*) FROM backorders WHERE item_id IN (<ids>)
UNION ALL SELECT 'item_packaging_levels', count(*) FROM item_packaging_levels WHERE item_id IN (<ids>)
UNION ALL SELECT 'item_barcodes', count(*) FROM item_barcodes WHERE item_id IN (<ids>);

-- 4) Indirect effects in the affected tenant during the run window
--    (replace :t0/:t1 with the created_at range from query 1)
SELECT count(*) FROM audit_logs WHERE tenant_id = :tenant AND created_at BETWEEN :t0 AND :t1;
SELECT id, status, updated_at FROM purchase_orders
 WHERE tenant_id = :tenant AND updated_at BETWEEN :t0 AND :t1;
-- plus journal/accounting entries and outbox rows created in the same window
```

Separating test from real data: fixture rows are exactly those whose item name
matches the markers or whose id is in the item list from query 1; anything
else in the same tables/tenant is real. Preserve audit logs untouched.
Anything that requires a live connection, the service-role key, or any cleanup
needs explicit owner approval first.
