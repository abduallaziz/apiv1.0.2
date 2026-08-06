-- Migration 13.1B — Roadmap Item #1 (Organization Structure) completion.
-- Enforces the Company -> Branch -> Warehouse -> Location hierarchy that was
-- already implied by the schema (warehouses.branch_id has existed since
-- migration 016) but never required. All pre-existing branch_id IS NULL rows
-- were resolved out-of-band before this migration ran: 20 confirmed
-- regression/E2E test fixtures were soft-deleted (deleted_at set, no data
-- changed), and all remaining rows (including the already-soft-deleted
-- TestSprite fixtures) were backfilled to the tenant's Main Branch — see
-- Migration 13.1A audit report. No inventory_core, stock_movements, or
-- costing tables are touched here.
ALTER TABLE warehouses
  ALTER COLUMN branch_id SET NOT NULL;

-- Down migration (manual, if ever required):
-- ALTER TABLE warehouses ALTER COLUMN branch_id DROP NOT NULL;
