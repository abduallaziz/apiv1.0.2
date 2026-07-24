-- Inventory redesign — Part A item #13: FEFO (First-Expired-First-Out).
--
-- Today cost_layers are consumed strictly by received_at (FIFO), even
-- when a layer is linked to a batch with a real expiration_date — a
-- batch expiring tomorrow could sit unsold behind fresher stock that
-- happens to have been received first. This reorders consumption to
-- prioritize the soonest-expiring batch first; layers with no batch (or
-- a batch with no expiration_date) sort after all expiring ones and fall
-- back to plain FIFO among themselves — unchanged behavior for anyone
-- not using batch/expiry tracking.
--
-- CREATE OR REPLACE with the IDENTICAL signature as migration 105 (same
-- 6 params, same p_allow_partial default) — every call site is
-- unaffected except for which physical layer gets picked first.
CREATE OR REPLACE FUNCTION fn_consume_cost_layers(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_quantity      NUMERIC,
  p_allow_partial BOOLEAN DEFAULT false
) RETURNS NUMERIC AS $$
DECLARE
  v_layer        RECORD;
  v_remaining_to_consume NUMERIC := p_quantity;
  v_total_cost   NUMERIC := 0;
  v_take         NUMERIC;
  v_consumed     NUMERIC;
BEGIN
  FOR v_layer IN
    SELECT cl.*
    FROM cost_layers cl
    LEFT JOIN item_batches ib ON ib.id = cl.batch_id
     WHERE cl.tenant_id = p_tenant_id AND cl.warehouse_id = p_warehouse_id AND cl.item_id = p_item_id
       AND COALESCE(cl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND cl.quantity_remaining > 0
     ORDER BY ib.expiration_date ASC NULLS LAST, cl.received_at ASC
     FOR UPDATE OF cl
  LOOP
    EXIT WHEN v_remaining_to_consume <= 0;

    v_take := LEAST(v_layer.quantity_remaining, v_remaining_to_consume);

    UPDATE cost_layers SET quantity_remaining = quantity_remaining - v_take WHERE id = v_layer.id;

    v_total_cost := v_total_cost + (v_take * v_layer.unit_cost);
    v_remaining_to_consume := v_remaining_to_consume - v_take;
  END LOOP;

  v_consumed := p_quantity - v_remaining_to_consume;

  IF v_remaining_to_consume > 0 THEN
    IF NOT p_allow_partial THEN
      RAISE EXCEPTION 'INSUFFICIENT_COST_LAYERS: could not source cost for % of item % at warehouse %',
        v_remaining_to_consume, p_item_id, p_warehouse_id;
    END IF;
    IF v_consumed = 0 THEN
      RETURN 0;
    END IF;
    RETURN ROUND(v_total_cost / v_consumed, 4);
  END IF;

  RETURN ROUND(v_total_cost / p_quantity, 4);
END;
$$ LANGUAGE plpgsql;

-- No hard block on selling an already-expired batch existed before,
-- and none is added here either — per the original audit, that's a
-- separate, deliberate policy decision (some businesses legitimately
-- discount/sell near-dated or technically-expired stock rather than
-- destroy it), not something to silently enforce as a side effect of
-- fixing consumption order. Flagging it, not building it, unless asked.
