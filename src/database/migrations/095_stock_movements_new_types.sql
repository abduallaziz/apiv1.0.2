-- =============================================================================
-- 095 — stock_movements: widen movement_type to add missing enterprise types
-- =============================================================================
-- Schema change only, additive, backward compatible. Confirmed via full
-- codebase review (Inventory Redesign Phase 1) that every existing writer of
-- stock_movements (fn_apply_stock_movement callers in migrations 019, 023,
-- 031, 032, 043) uses only the original 9 values — this constraint change
-- does not affect any existing row or caller. No fn_apply_stock_movement
-- change here (that's migration 096).
-- =============================================================================

ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'receipt','sale','sale_return','adjustment_in','adjustment_out',
    'transfer_out','transfer_in','count_correction_in','count_correction_out',
    'purchase_return','damage','expiry','production_consumption','production_receipt'
  ));
