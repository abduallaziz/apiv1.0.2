-- 190 — price_override_policies (D01-M2, approved 2026-08-13)
-- "Approved – Proceed with D01-M2." Scope, exactly as designed across the
-- full D01-M2 design review series: the table, its scope/reason/percent
-- CHECKs, 3 partial unique indexes (Tenant/Branch/Role scope, NULL != NULL
-- in Postgres makes a plain UNIQUE insufficient — same pattern already
-- proven in roles' idx_roles_system_name_unique), the role-guard trigger
-- (system roles except superadmin allowed; custom roles must match tenant
-- and be a hierarchy participant), and RLS matching the exact
-- tenant_session_isolation pattern used throughout M181-M184.
--
-- Does NOT touch: price_override_audit, order_items.official_price_snapshot,
-- resolveEffectiveRole(), PriceResolutionService, InvoicesService,
-- invoice.price_override grants, any UI, Model A/B authorization. No
-- Tenant Default Policy is seeded for any tenant — absence is deliberate
-- Fail-Closed behavior enforced later at the application layer (D01-M6+),
-- not something this migration creates or backfills.

CREATE TABLE price_override_policies (
  id                              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id                       UUID        REFERENCES branches(id),
  role_id                         UUID        REFERENCES roles(id),

  -- Every Boolean below is deliberately NULLABLE with NO DEFAULT — NULL
  -- means "inherit from the level above" (Tenant->Branch->Role), TRUE/FALSE
  -- means an explicit decision at this level. A DEFAULT false would silently
  -- turn "not yet configured" into "explicitly denied", breaking inheritance.
  allow_discount                  BOOLEAN,
  allow_increase                  BOOLEAN,
  allow_combine_with_discount     BOOLEAN,

  max_discount_percent            NUMERIC(5,2),
  max_increase_percent            NUMERIC(5,2),

  reason_policy                   TEXT CHECK (reason_policy IN ('not_required','always_required','required_above_threshold','optional')),
  reason_threshold_percent        NUMERIC(5,2),

  allow_zero_price                BOOLEAN,
  zero_price_requires_permission  BOOLEAN,
  zero_price_requires_reason      BOOLEAN,

  created_by                      UUID REFERENCES users(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scope validity: Tenant Default (branch NULL, role NULL), Branch Override
-- (branch set, role NULL), Role Override (branch set, role set). The
-- explicitly forbidden combination (branch NULL, role NOT NULL) has no
-- branch that a role-record. Row-local — no subquery needed.
ALTER TABLE price_override_policies ADD CONSTRAINT chk_price_override_policies_scope CHECK (
  (branch_id IS NULL AND role_id IS NULL)
  OR (branch_id IS NOT NULL AND role_id IS NULL)
  OR (branch_id IS NOT NULL AND role_id IS NOT NULL)
);

-- required_above_threshold without a threshold has no decision point —
-- reject at the DB level rather than leaving it ambiguous at read time.
ALTER TABLE price_override_policies ADD CONSTRAINT chk_reason_threshold_consistency CHECK (
  (reason_policy IS DISTINCT FROM 'required_above_threshold') OR (reason_threshold_percent IS NOT NULL)
);

-- Only the mathematically impossible case (negative percentage) is
-- blocked — no business-maximum guess (e.g. capping at 100) is imposed
-- here; no evidence in the project justifies one.
ALTER TABLE price_override_policies ADD CONSTRAINT chk_percent_non_negative CHECK (
  (max_discount_percent IS NULL OR max_discount_percent >= 0)
  AND (max_increase_percent IS NULL OR max_increase_percent >= 0)
  AND (reason_threshold_percent IS NULL OR reason_threshold_percent >= 0)
);

-- Postgres treats NULL != NULL for uniqueness purposes (same reasoning
-- already documented in 059_create_roles_table.sql for system role names)
-- — a plain UNIQUE(tenant_id, branch_id, role_id) would NOT catch a
-- duplicate Tenant Default or Branch Override row. Three partial unique
-- indexes, one per scope level, each doubling as the lookup index for
-- that exact query pattern.
CREATE UNIQUE INDEX uq_price_override_policies_tenant
  ON price_override_policies (tenant_id) WHERE branch_id IS NULL AND role_id IS NULL;

CREATE UNIQUE INDEX uq_price_override_policies_branch
  ON price_override_policies (tenant_id, branch_id) WHERE branch_id IS NOT NULL AND role_id IS NULL;

CREATE UNIQUE INDEX uq_price_override_policies_role
  ON price_override_policies (tenant_id, branch_id, role_id) WHERE branch_id IS NOT NULL AND role_id IS NOT NULL;

ALTER TABLE price_override_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON price_override_policies
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.price_override_policies TO service_role;

-- ============================================================
-- Role guard — role_id is a PLAIN FK to roles.id (not a tenant-composite
-- FK), deliberately, so a system role (roles.tenant_id IS NULL) can be
-- referenced from any tenant's policy. That plain FK cannot express
-- "a custom role must belong to the same tenant as this policy row" —
-- comparing this row's tenant_id against another table's row is not
-- row-local, so a CHECK constraint cannot do it (confirmed: PostgreSQL
-- CHECK constraints cannot contain subqueries against other tables). This
-- trigger is the only mechanism capable of it, reading the referenced
-- role's tenant_id/name/is_hierarchy_participant in one SELECT.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_guard_price_override_policies_role() RETURNS TRIGGER AS $$
DECLARE
  v_role_name         TEXT;
  v_role_tenant_id     UUID;
  v_role_participant   BOOLEAN;
BEGIN
  IF NEW.role_id IS NOT NULL THEN
    SELECT name, tenant_id, is_hierarchy_participant
      INTO v_role_name, v_role_tenant_id, v_role_participant
      FROM roles WHERE id = NEW.role_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Role % does not exist', NEW.role_id;
    END IF;

    -- superadmin is platform-level, never an operational tenant role —
    -- excluded from D01 Role Policy per explicit owner decision.
    IF v_role_name = 'superadmin' THEN
      RAISE EXCEPTION 'Role superadmin is platform-level and cannot have a price override Role Policy';
    END IF;

    -- System role (tenant_id IS NULL) usable across any tenant — no match
    -- required. Custom role must belong to the exact same tenant.
    IF v_role_tenant_id IS NOT NULL AND v_role_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'Role % belongs to a different tenant and cannot be used in this policy', NEW.role_id;
    END IF;

    -- A role not participating in the hierarchy can never become an
    -- Effective Role, so a policy row for it could never be read — reject
    -- at creation rather than silently storing an unusable row.
    IF v_role_participant IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Role % does not participate in the hierarchy and cannot have a Role Policy', NEW.role_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_override_policies_role_guard
BEFORE INSERT OR UPDATE ON price_override_policies
FOR EACH ROW EXECUTE FUNCTION fn_guard_price_override_policies_role();

-- No Tenant Default Policy seeded for any tenant. Absence is intentional
-- Fail-Closed behavior, enforced by the (not-yet-built) application read
-- path in a later migration — not something created or backfilled here.

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_price_override_policies_role_guard ON price_override_policies;
-- DROP FUNCTION IF EXISTS fn_guard_price_override_policies_role();
-- DROP TABLE IF EXISTS price_override_policies;
