-- Migration 13.13-fix — Roadmap #13 completion: expired-batch advisory
-- warning. Advisory-only, mirrors fn_check_quality_holds (migration 145)
-- exactly — read-only, STABLE, called by InvoicesService BEFORE (not
-- during/inside) fn_process_sale_stock_deduction, never blocks a sale.
-- No column added to item_batches/stock_levels/stock_movements/cost_layers,
-- no change to fn_consume_cost_layers or its FEFO ordering (migration 108).
--
-- Scope: reports whether an item/variant currently has any remaining
-- stock (cost_layers.quantity_remaining > 0) sourced from a batch whose
-- expiration_date has already passed, at the given warehouse. It does not
-- predict or reserve which specific batch FEFO will actually consume for
-- a given sale — that decision remains fn_consume_cost_layers' alone,
-- unchanged. This is a visibility signal, not a simulation of the
-- consumption path.
CREATE OR REPLACE FUNCTION fn_check_expired_batches(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_items        JSONB
)
RETURNS TABLE (
  item_id         UUID,
  variant_id      UUID,
  item_name       TEXT,
  batch_id        UUID,
  batch_number    TEXT,
  expiration_date DATE
) AS $$
  SELECT DISTINCT
    cl.item_id,
    cl.variant_id,
    i.name AS item_name,
    ib.id AS batch_id,
    ib.batch_number,
    ib.expiration_date
  FROM jsonb_to_recordset(p_items) AS x(item_id UUID, variant_id UUID)
  JOIN cost_layers cl
    ON cl.tenant_id = p_tenant_id
    AND cl.warehouse_id = p_warehouse_id
    AND cl.item_id = x.item_id
    AND COALESCE(cl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(x.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND cl.quantity_remaining > 0
  JOIN item_batches ib ON ib.id = cl.batch_id
  JOIN items i ON i.id = cl.item_id
  WHERE ib.expiration_date IS NOT NULL AND ib.expiration_date < CURRENT_DATE;
$$ LANGUAGE sql STABLE;
