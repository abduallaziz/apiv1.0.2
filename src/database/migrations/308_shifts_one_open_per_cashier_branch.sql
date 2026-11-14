-- Migration 308: one open shift per (tenant, cashier, branch).
-- Under branch isolation a cashier/owner may keep a shift open in each branch.
-- Tenants WITHOUT isolation keep the old rule: the application still refuses a
-- second open shift for the cashier tenant-wide (ShiftsService.openShift).
-- Additive + idempotent: the new (looser) index is created before the old one is dropped.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_cashier_branch
  ON shifts (tenant_id, cashier_id, branch_id)
  WHERE status = 'open' AND deleted_at IS NULL;

DROP INDEX IF EXISTS uq_shifts_one_open_per_cashier;

-- ROLLBACK (only if no cashier has open shifts in two branches):
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_cashier
--   ON shifts (tenant_id, cashier_id) WHERE status = 'open' AND deleted_at IS NULL;
-- DROP INDEX IF EXISTS uq_shifts_one_open_per_cashier_branch;
