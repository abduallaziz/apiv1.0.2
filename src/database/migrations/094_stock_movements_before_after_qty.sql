-- =============================================================================
-- 094 — stock_movements: before/after quantity snapshot columns
-- =============================================================================
-- Additive only. Nullable, no default — existing (historical) rows get NULL
-- automatically (this is a metadata-only ALTER, no UPDATE statement touches
-- any existing row). Only movements written after 096 (fn_apply_stock_movement
-- update) populate these. Turns stock_movements into a fully auditable ledger
-- per Inventory Redesign Phase 1.
-- =============================================================================

ALTER TABLE stock_movements
  ADD COLUMN before_quantity NUMERIC(14,4),
  ADD COLUMN after_quantity  NUMERIC(14,4);
