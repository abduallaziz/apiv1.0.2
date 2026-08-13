-- Migration 13.20 Part 3 — Picking enterprise validation: batch/serial
-- requirements + FEFO suggestion. Does NOT rebuild picking or duplicate
-- reservation logic — pick_lists/fn_create_pick_list/fn_confirm_pick
-- (migration 116) are completely untouched. This adds a nullable batch_id
-- to pick_list_lines (so a batch-tracked pick can record which batch was
-- actually taken) plus two new read-only/validation-only functions the
-- application layer calls around the existing fn_confirm_pick, not inside it.

ALTER TABLE pick_list_lines ADD COLUMN batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL;

-- FEFO suggestion: earliest-expiring batch at a location with enough
-- quantity_remaining (read from cost_layers, the real per-batch quantity
-- source — item_batches itself has no quantity column). Read-only.
CREATE OR REPLACE FUNCTION fn_suggest_fefo_batch(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID,
  p_quantity     NUMERIC
) RETURNS TABLE (batch_id UUID, expiration_date DATE, quantity_available NUMERIC) AS $$
  SELECT ib.id, ib.expiration_date, cl.quantity_remaining
  FROM cost_layers cl
  JOIN item_batches ib ON ib.id = cl.batch_id
  WHERE cl.tenant_id = p_tenant_id AND cl.warehouse_id = p_warehouse_id
    AND cl.item_id = p_item_id
    AND COALESCE(cl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND cl.quantity_remaining >= p_quantity
    AND ib.expiration_date IS NOT NULL
  ORDER BY ib.expiration_date ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Validation gate: raises if a batch/serial-tracked item is being picked
-- without the required identifier, or if the given batch is not the
-- earliest-expiring one (FEFO enforcement) when a strictly-earlier batch
-- has enough quantity. The application layer calls this BEFORE
-- fn_confirm_pick — it is deliberately a separate function, not a change
-- to fn_confirm_pick's own body, so the already-tested picking engine
-- (migration 116) is not touched.
CREATE OR REPLACE FUNCTION fn_validate_pick_requirements(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID,
  p_quantity     NUMERIC,
  p_batch_id     UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_track_batches BOOLEAN;
  v_track_serial BOOLEAN;
  v_fefo_batch_id UUID;
  v_fefo_expiration DATE;
  v_given_expiration DATE;
BEGIN
  SELECT track_batches, track_serial INTO v_track_batches, v_track_serial FROM items WHERE id = p_item_id;

  IF (v_track_batches OR v_track_serial) AND p_batch_id IS NULL THEN
    RAISE EXCEPTION 'BATCH_OR_SERIAL_REQUIRED: item % requires a batch/serial identifier to pick', p_item_id;
  END IF;

  IF p_batch_id IS NOT NULL THEN
    SELECT expiration_date INTO v_given_expiration FROM item_batches WHERE id = p_batch_id AND tenant_id = p_tenant_id;
    IF v_given_expiration IS NOT NULL THEN
      SELECT batch_id, expiration_date INTO v_fefo_batch_id, v_fefo_expiration
      FROM fn_suggest_fefo_batch(p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_quantity);
      IF v_fefo_batch_id IS NOT NULL AND v_fefo_batch_id <> p_batch_id AND v_fefo_expiration < v_given_expiration THEN
        RAISE EXCEPTION 'FEFO_VIOLATION: batch % (expires %) was picked ahead of an earlier-expiring batch % (expires %)',
          p_batch_id, v_given_expiration, v_fefo_batch_id, v_fefo_expiration;
      END IF;
    END IF;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;
