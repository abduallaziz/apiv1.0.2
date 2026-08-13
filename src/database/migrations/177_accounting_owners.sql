-- Sefay Global Financial Platform — Migration M177 (rebuilt)
-- Accounting Owner — the single, non-polymorphic entity a future Ledger/
-- Journal will belong to. This is a fresh migration, distinct from the
-- removed prior M177 (`companies`) and prior M178 (`accounting_owners`
-- with `company_id`). Both were fully reverted from the live database
-- (see STATUS.md, 2026-08-10 correction) after the authoritative
-- architectural decision: Tenant = Company. There is no Company entity
-- in Sefay. Tenant is the sole authoritative business/legal identity.
--
-- Scope, exactly as approved by the Final Pre-Implementation Correction:
--   - accounting_owners ONLY.
--   - tenant_id NOT NULL is the sole, direct ownership anchor — no
--     company_id, no companies table, no FK to any Company-like entity.
--   - branch_id NULLABLE, composite FK to branches(tenant_id, id) — the
--     approved mechanism for representing Central/Regional/purely-
--     financial accounting structures that correspond to no physical
--     branch (branch_id IS NULL = Central Accounting, no fake Branch).
--   - owner_type_code, plain FK to the GLOBAL accounting_owner_types
--     catalog from M176 (no tenant_id on that side — not tenant-owned
--     data, so no composite FK is needed or correct there).
--
-- NOT in scope here (belong to later, separately-approved migrations):
-- Branch Accounting Assignment History (M178), Fiscal Calendar/Year/
-- Period (M179), Accounting Book (M180), Accounts (M181), Journal (M182).
-- No companies, company_id, Ledger, Book, Fiscal Calendar, Chart of
-- Accounts, or Journal object is created here. No polymorphic ownership.
-- Inventory/WMS is completely untouched — this migration adds a
-- constraint `branches` already unconditionally satisfies; it does not
-- change any column, trigger, or RLS policy Inventory/WMS depends on.

-- Step 1: tenant-safe composite FK target for `branches`, required
-- before accounting_owners.branch_id can safely reference it. Pure
-- additive constraint: `id` is already the PRIMARY KEY (globally
-- unique), so (tenant_id, id) is trivially unique for every existing
-- row — cannot fail against current data, requires no data
-- transformation, and changes no existing query or RLS policy on
-- `branches`. (This constraint was previously added and then removed
-- during the M177–M179 rollback; re-added here as part of this fresh
-- migration's own scope.)
ALTER TABLE branches ADD CONSTRAINT uq_branches_tenant_id UNIQUE (tenant_id, id);

-- Step 2: accounting_owners itself.
CREATE TABLE accounting_owners (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       UUID,
  owner_type_code TEXT        NOT NULL REFERENCES accounting_owner_types(code),
  name            TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite, tenant-safe FK — the proven mechanism (Final Schema
  -- Integrity Review): a plain single-column FK only guarantees the
  -- referenced row exists, not that it belongs to the same tenant. RLS
  -- does not substitute for this (FK checks are not RLS-filtered), so
  -- the composite pair is a database-level guarantee, independent of
  -- any session's RLS context.
  CONSTRAINT fk_accounting_owners_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),

  -- Tenant-safe composite-FK target for future migrations (M178's
  -- Branch Accounting Assignment History, and later Accounting Book).
  CONSTRAINT uq_accounting_owners_tenant_id UNIQUE (tenant_id, id)
);

-- A branch that IS independently accounted has at most one Accounting
-- Owner representing it, ever.
CREATE UNIQUE INDEX uq_accounting_owners_tenant_branch ON accounting_owners(tenant_id, branch_id) WHERE branch_id IS NOT NULL;

CREATE INDEX idx_accounting_owners_tenant ON accounting_owners(tenant_id);

ALTER TABLE accounting_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON accounting_owners
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.accounting_owners TO service_role;

-- No seed data, no backfill: Accounting Owners are created on-demand by
-- future business logic when a tenant actually enables Accounting —
-- never pre-provisioned for every existing tenant.

-- Rollback (documented, not auto-executed):
-- DROP TABLE IF EXISTS accounting_owners; -- safe only if no downstream row references it yet
-- ALTER TABLE branches DROP CONSTRAINT IF EXISTS uq_branches_tenant_id;
