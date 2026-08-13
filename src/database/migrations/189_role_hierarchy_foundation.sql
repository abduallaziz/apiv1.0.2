-- 189 — Role Hierarchy Foundation (D01-M0, approved 2026-08-11)
-- "Approved – Proceed with D01-M0." Scope, exactly as designed across the
-- full D01-M0 design review series: roles.priority + roles.is_hierarchy_participant,
-- the 7 system role fixed values, safe transition for the 3 existing custom
-- roles, a row-local CHECK for final-state validity, and a BEFORE UPDATE
-- trigger for identity immutability (CHECK alone cannot compare OLD vs NEW,
-- confirmed unable to prevent a system-role row being converted into a
-- custom-role row in one UPDATE, or vice versa).
--
-- Does NOT touch: invoice.price_override, price_override_policies,
-- price_override_audit, order_items, InvoicesService, hasPermissionForUser,
-- PermissionGuard, resolveUserPermission, user_roles, role_permissions,
-- tenant_role_permissions, user_permissions_override. Effective Role
-- resolution and D01 Policy logic are NOT built here — this migration is
-- the data foundation only, per D01-M0's explicitly narrowed scope.

-- Step 1: add both columns nullable-safe via DEFAULT, then backfill
-- explicitly, matching the safe-migration pattern already used in this
-- project (M187/M188) for adding NOT NULL columns to tables with existing
-- rows — never fabricate business meaning for existing data no evidence
-- supports (the 3 custom roles get the neutral "unclassified" state, not
-- a guessed business priority).
ALTER TABLE roles ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roles ADD COLUMN is_hierarchy_participant BOOLEAN NOT NULL DEFAULT false;

-- Step 2: pin the 7 system roles to their approved, evidence-based values
-- (scope breadth from permissions.seed.ts's rolePerms grant counts, with
-- superadmin ranked above owner despite a marginally smaller raw grant
-- count because its grants are the only genuinely cross-tenant ones).
UPDATE roles SET priority = 100, is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'superadmin';
UPDATE roles SET priority = 90,  is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'owner';
UPDATE roles SET priority = 70,  is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'manager';
UPDATE roles SET priority = 50,  is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'cashier';
UPDATE roles SET priority = 50,  is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'inventory_clerk';
UPDATE roles SET priority = 30,  is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'worker';
UPDATE roles SET priority = 0,   is_hierarchy_participant = true WHERE tenant_id IS NULL AND name = 'none';

-- Step 3: the 3 existing custom roles (lowPrivilegeRole_TC006, اختبار, سيب —
-- all 0 users, 0 verified production usage, first two explicitly named as
-- test/experiment roles) already satisfy priority=0/is_hierarchy_participant=false
-- via the column DEFAULTs above — no explicit UPDATE needed or performed.
-- They remain "unclassified", not "ranked at the bottom" — Owner must
-- explicitly classify them later if ever needed.

-- Step 4: row-local CHECK — final-state validity only. Every branch
-- compares only columns of the SAME row (name, tenant_id, priority,
-- is_hierarchy_participant) — PostgreSQL CHECK constraints cannot contain
-- subqueries against other rows, confirmed directly (not assumed) during
-- design review; none is used here.
ALTER TABLE roles ADD CONSTRAINT chk_roles_priority_bounds CHECK (
  (tenant_id IS NULL AND name = 'superadmin'      AND priority = 100 AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'owner'           AND priority = 90  AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'manager'         AND priority = 70  AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'cashier'         AND priority = 50  AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'inventory_clerk' AND priority = 50  AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'worker'          AND priority = 30  AND is_hierarchy_participant = true) OR
  (tenant_id IS NULL AND name = 'none'            AND priority = 0   AND is_hierarchy_participant = true) OR
  (tenant_id IS NOT NULL AND is_hierarchy_participant = false AND priority = 0) OR
  (tenant_id IS NOT NULL AND is_hierarchy_participant = true  AND priority > 0 AND priority < 90)
);

-- Step 5: BEFORE UPDATE trigger — identity immutability. CHECK alone
-- validates only the resulting row state, never the OLD->NEW transition,
-- so it cannot stop a system role being converted into a custom role (or
-- vice versa) by changing several columns in one UPDATE — confirmed by
-- direct trace of the exact attack example reviewed in design: setting
-- tenant_id/is_system/priority/is_hierarchy_participant together on the
-- 'owner' row would satisfy the "unclassified custom role" CHECK branch
-- above. Same guard-trigger pattern already proven 3 times in this project
-- (fn_guard_accounts_mutation/181, fn_guard_branch_accounting_assignment_mutation/178,
-- fn_guard_fiscal_calendar_mutation/179) — same naming, same plain
-- LANGUAGE plpgsql (no SECURITY DEFINER, matching those three), same
-- IS DISTINCT FROM comparison style, same RAISE EXCEPTION style.
-- description/updated_at are deliberately left unguarded — pure metadata,
-- not identity or hierarchy fields.
CREATE OR REPLACE FUNCTION fn_guard_roles_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS NULL THEN
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.is_system IS DISTINCT FROM OLD.is_system
         OR NEW.priority IS DISTINCT FROM OLD.priority
         OR NEW.is_hierarchy_participant IS DISTINCT FROM OLD.is_hierarchy_participant THEN
        RAISE EXCEPTION 'System role % (%) identity and hierarchy fields are protected and cannot be changed', OLD.name, OLD.id;
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'A custom role (%) cannot be converted into a system role', OLD.id;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_roles_guard
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION fn_guard_roles_mutation();

-- Not in scope for D01-M0 (per explicit design-review decision, not an
-- oversight): DELETE protection on system roles (already structurally
-- unreachable via the live deleteRole() application code path, since it
-- filters .eq('tenant_id', tenantId) and system rows always have
-- tenant_id IS NULL), and the is_primary uniqueness gap on user_roles
-- (unrelated table, flagged separately for D01-M5).

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_roles_guard ON roles;
-- DROP FUNCTION IF EXISTS fn_guard_roles_mutation();
-- ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_priority_bounds;
-- ALTER TABLE roles DROP COLUMN IF EXISTS is_hierarchy_participant;
-- ALTER TABLE roles DROP COLUMN IF EXISTS priority;
