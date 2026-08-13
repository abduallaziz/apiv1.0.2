-- 187 — Sale Idempotency (Migration Matrix item #1, approved 2026-08-11)
-- "APPROVED – Proceed with M187 ONLY". Goal: prevent duplicate completed
-- orders from double-click, client retry, network replay, or multiple tabs.
-- Scope, exactly as approved: orders.sale_attempt_id + its uniqueness only.
-- Does NOT touch M182/M184, accounting posting, inventory, loyalty, split,
-- tab, dine-in, or cancel/reversal logic.
--
-- Historical-row safety (per explicit instruction: do not fabricate values
-- unless the NOT NULL constraint technically requires it): 133 existing
-- completed orders have no natural sale_attempt_id (the concept didn't
-- exist when they were created). `DEFAULT uuid_generate_v4()` at ALTER
-- TABLE time is the standard, non-invasive Postgres mechanism to satisfy
-- NOT NULL for pre-existing rows — each historical row gets a mechanically
-- generated, globally-unique placeholder value that carries no business
-- meaning and is never read/compared against anything (no code reads
-- sale_attempt_id for historical orders). The DEFAULT is dropped
-- immediately after backfilling existing rows, so every future INSERT must
-- supply an explicit value from the application — the database no longer
-- silently generates one, forcing genuine client-side idempotency going
-- forward.
ALTER TABLE orders ADD COLUMN sale_attempt_id UUID NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE orders ALTER COLUMN sale_attempt_id DROP DEFAULT;

-- Tenant-scoped uniqueness, matching this codebase's established composite-
-- uniqueness convention (accounting_owners, accounts, account_role_assignments,
-- etc. — never a bare global UNIQUE on a business column). A client-
-- generated UUID has negligible collision probability across tenants
-- regardless, but tenant-scoping keeps this consistent with every other
-- uniqueness rule in the schema and matches the tenant-isolation model.
ALTER TABLE orders ADD CONSTRAINT uq_orders_tenant_sale_attempt UNIQUE (tenant_id, sale_attempt_id);

-- Rollback (documented, not auto-executed):
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_tenant_sale_attempt;
-- ALTER TABLE orders DROP COLUMN IF EXISTS sale_attempt_id;
