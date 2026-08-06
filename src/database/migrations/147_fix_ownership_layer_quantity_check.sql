-- Migration 10.1 fix — stock_ownership_layers.quantity CHECK was too strict.
-- fn_consume_ownership_layers (146) sets quantity = 0 when a layer is fully
-- consumed and closed, but the original CHECK (quantity > 0) rejected that
-- write — found via regression testing before this migration was reported
-- complete. quantity = 0 is only ever valid alongside status = 'closed'.
ALTER TABLE stock_ownership_layers
  DROP CONSTRAINT stock_ownership_layers_quantity_check;

ALTER TABLE stock_ownership_layers
  ADD CONSTRAINT stock_ownership_layers_quantity_check
  CHECK (quantity > 0 OR (quantity = 0 AND status = 'closed'));
