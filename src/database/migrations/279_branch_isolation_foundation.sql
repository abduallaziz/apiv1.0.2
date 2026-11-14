-- 279_branch_isolation_foundation.sql  (Branch isolation P0 — owner-approved, see docs/DESIGN_BRANCH_ISOLATION.md D1/D2)
-- Additive only. Behaviour changes only when tenants.branch_isolation_enabled is turned on for a tenant.
--
--  * tenants.branch_isolation_enabled : per-tenant rollout flag (default false).
--  * branches.is_main                 : the tenant's main branch (at most one live row per tenant).
--    Backfill: the earliest created, live, active branch of each tenant; a branch whose name starts
--    with 'Main' wins over an earlier one.
-- ROLLBACK: DROP INDEX IF EXISTS uq_branches_one_main_per_tenant;
--           ALTER TABLE branches DROP COLUMN IF EXISTS is_main;
--           ALTER TABLE tenants DROP COLUMN IF EXISTS branch_isolation_enabled;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS branch_isolation_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;

-- Backfill only tenants that have no main branch yet (idempotent).
WITH candidates AS (
  SELECT DISTINCT ON (b.tenant_id)
         b.id, b.tenant_id
    FROM branches b
   WHERE b.deleted_at IS NULL
     AND b.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM branches m
        WHERE m.tenant_id = b.tenant_id AND m.is_main AND m.deleted_at IS NULL
     )
   ORDER BY b.tenant_id,
            (b.name ILIKE 'main%') DESC,
            b.created_at ASC,
            b.id ASC
)
UPDATE branches b
   SET is_main = true
  FROM candidates c
 WHERE b.id = c.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_one_main_per_tenant
  ON branches (tenant_id)
  WHERE is_main AND deleted_at IS NULL;
