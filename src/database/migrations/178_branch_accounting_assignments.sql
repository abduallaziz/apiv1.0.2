-- Sefay Global Financial Platform — Migration M178
-- Branch Accounting Assignment History — the effective-dated,
-- exclusion-constrained relationship recording which Accounting Owner a
-- Branch's transactions route to, over time. This is the mechanism that
-- makes "Independent → Central → Independent" (and every other topology
-- transition) historically correct rather than reinterpreted by whatever
-- the topology happens to be today.
--
-- This is a fresh migration, distinct from the removed prior M179 (which
-- was fully reverted from the live database — see STATUS.md, 2026-08-10
-- correction — as part of the Company rollback, even though its own
-- design never depended on Company at all). Its content is unchanged in
-- substance from that proven-correct design; only the migration number
-- and its FK target (the rebuilt M177 `accounting_owners`, which already
-- carries `UNIQUE(tenant_id, id)` from its own creation, so no
-- prerequisite constraint needs to be added here) differ.
--
-- Ownership validation boundary (explicitly documented, not silently
-- invented): `branches` has no `company_id` column at all, and Company
-- does not exist in Sefay (Tenant = Company). Branch Accounting
-- Assignment routes a Branch directly to an Accounting Owner, which is
-- anchored directly to `tenant_id` — no Company-layer check is needed or
-- possible, and none is required by the approved architecture.
--
-- No Ledger, Accounting Book, Fiscal Calendar, Chart of Accounts,
-- Journal, or Journal Line object is created here. No mutable current-
-- state topology flag is introduced. No polymorphic ownership.
-- Inventory/WMS is untouched.

CREATE TABLE branch_accounting_assignments (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id            UUID        NOT NULL,
  accounting_owner_id  UUID        NOT NULL,
  effective_from       DATE        NOT NULL,
  effective_to         DATE,
  reason               TEXT,
  created_by           UUID        REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite, tenant-safe FKs — proven at the database level, not RLS.
  CONSTRAINT fk_branch_accounting_assignments_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  CONSTRAINT fk_branch_accounting_assignments_owner
    FOREIGN KEY (tenant_id, accounting_owner_id) REFERENCES accounting_owners (tenant_id, id),

  -- Date-range sanity: effective_to, when set, must be strictly after
  -- effective_from. NULL effective_to represents the open-ended, current
  -- assignment — deterministic (there is at most one such row per branch,
  -- enforced by the exclusion constraint below, not by this CHECK alone).
  CONSTRAINT chk_branch_accounting_assignments_dates
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- The critical database-level integrity guarantee: no two assignments for
-- the same (tenant, branch) may have overlapping effective periods.
-- Half-open interval semantics `[effective_from, effective_to)` — via
-- daterange's default bound flags — mean a period ending exactly where
-- the next one begins is NOT an overlap. A NULL effective_to is treated
-- by daterange as unbounded-above, giving the open-ended "current"
-- assignment deterministic, correct range semantics with no special
-- casing required. Requires btree_gist (enabled in M176) for the UUID
-- equality operator class inside a GiST exclusion constraint.
ALTER TABLE branch_accounting_assignments
  ADD CONSTRAINT excl_branch_accounting_assignments_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    branch_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

-- Query pattern: "current Accounting Owner for Branch" — the hottest
-- lookup path (every posting-time resolution hits this).
CREATE UNIQUE INDEX uq_branch_accounting_assignments_current ON branch_accounting_assignments(tenant_id, branch_id) WHERE effective_to IS NULL;

-- Query pattern: "all Branches assigned to this Accounting Owner"
-- (Central Accounting's aggregation/drill-down path).
CREATE INDEX idx_branch_accounting_assignments_owner ON branch_accounting_assignments(tenant_id, accounting_owner_id);

-- Query pattern: historical assignment timeline for a branch, in order.
CREATE INDEX idx_branch_accounting_assignments_branch_timeline ON branch_accounting_assignments(tenant_id, branch_id, effective_from);

-- Point-in-time "Branch -> Owner at date X" is served by the exclusion
-- constraint's own implicit GiST index — no separate index needed.

ALTER TABLE branch_accounting_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON branch_accounting_assignments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.branch_accounting_assignments TO service_role;

-- Auditability / deletion policy:
--   - DELETE is always blocked. An assignment, once created, is
--     permanent history — correction is forward-only (a new assignment
--     row), never a deletion of a past one.
--   - UPDATE is blocked for every column except one narrow, explicitly
--     allowed transition: setting `effective_to` on a row that currently
--     has `effective_to IS NULL` (closing the presently-open period the
--     moment a new assignment begins). Once a row's `effective_to` is
--     set, it is fully immutable from that point on.
CREATE OR REPLACE FUNCTION fn_guard_branch_accounting_assignment_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'branch_accounting_assignments is an append-only historical record — rows cannot be deleted. Correct forward with a new assignment instead.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.accounting_owner_id IS DISTINCT FROM OLD.accounting_owner_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      RAISE EXCEPTION 'branch_accounting_assignments rows are immutable except for closing effective_to on a currently-open assignment';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
      RAISE EXCEPTION 'This assignment period is already closed (effective_to is set) and cannot be modified further';
    END IF;
    RETURN NEW; -- allowed: OLD.effective_to IS NULL -> NEW.effective_to may be set exactly once
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_branch_accounting_assignments_guard
BEFORE UPDATE OR DELETE ON branch_accounting_assignments
FOR EACH ROW EXECUTE FUNCTION fn_guard_branch_accounting_assignment_mutation();

-- No seed data, no backfill: assignments are created on-demand only when
-- a tenant actually enables independent branch accounting or Central
-- Accounting for a specific branch — never pre-provisioned.

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_branch_accounting_assignments_guard ON branch_accounting_assignments;
-- DROP FUNCTION IF EXISTS fn_guard_branch_accounting_assignment_mutation();
-- DROP TABLE IF EXISTS branch_accounting_assignments;
