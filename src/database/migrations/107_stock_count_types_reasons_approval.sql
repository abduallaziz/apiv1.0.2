-- Inventory redesign — Part A item #12 continuation: Counting types,
-- variance reason codes, and a real approval gate separate from finalize.

-- Reusable reference table (same shape as units/brands from Products
-- Phase A) — not count-specific, applies_to lets it be reused later for
-- adjustments/damage/expiry reason tracking without a second table.
CREATE TABLE reason_codes (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  applies_to  TEXT        NOT NULL DEFAULT 'count' CHECK (applies_to IN ('count', 'adjustment', 'damage', 'expiry', 'transfer')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_reason_codes_tenant_code ON reason_codes(tenant_id, applies_to, code) WHERE deleted_at IS NULL;
ALTER TABLE reason_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON reason_codes
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.reason_codes TO service_role;

ALTER TABLE stock_counts ADD COLUMN count_type TEXT NOT NULL DEFAULT 'full' CHECK (count_type IN ('full', 'partial', 'cycle'));

-- Nullable, no default — NULL means "no approval workflow for this count"
-- (the overwhelming majority of existing/future counts), preserving
-- fn_finalize_stock_count's exact current behavior for anyone not opting
-- into approval. Only a count explicitly moved to 'pending_approval' can
-- ever block finalize.
ALTER TABLE stock_counts ADD COLUMN approval_status TEXT CHECK (approval_status IN ('pending_approval', 'approved', 'rejected'));
ALTER TABLE stock_counts ADD COLUMN approved_by UUID REFERENCES users(id);
ALTER TABLE stock_counts ADD COLUMN approved_at TIMESTAMPTZ;

ALTER TABLE stock_count_items ADD COLUMN reason_code_id UUID REFERENCES reason_codes(id) ON DELETE SET NULL;

-- Approve or reject a count pending approval. Separate step from
-- finalize, per spec — the actual stock corrections only ever get
-- posted by fn_finalize_stock_count itself, unchanged.
CREATE OR REPLACE FUNCTION fn_approve_stock_count(
  p_stock_count_id UUID,
  p_actor_id       UUID,
  p_approved       BOOLEAN
) RETURNS stock_counts AS $$
DECLARE
  v_count stock_counts;
BEGIN
  SELECT * INTO v_count FROM stock_counts WHERE id = p_stock_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock count % not found', p_stock_count_id;
  END IF;
  IF v_count.approval_status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'stock count % is not pending approval (approval_status=%)', p_stock_count_id, v_count.approval_status;
  END IF;

  UPDATE stock_counts
     SET approval_status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
         approved_by = p_actor_id,
         approved_at = NOW()
   WHERE id = p_stock_count_id
   RETURNING * INTO v_count;

  PERFORM _emit_domain_event(
    v_count.tenant_id, 'inventory.stock_count.approval_decided', 'stock_count', v_count.id,
    jsonb_build_object('approved', p_approved, 'actor_id', p_actor_id)
  );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- CREATE OR REPLACE with the IDENTICAL signature as migration 019 — only
-- addition is the approval guard at the top. A count with
-- approval_status NULL (never opted into approval) or 'approved' behaves
-- exactly as before; 'pending_approval'/'rejected' now blocks finalize.
CREATE OR REPLACE FUNCTION fn_finalize_stock_count(
  p_stock_count_id UUID,
  p_actor_id       UUID
) RETURNS stock_counts AS $$
DECLARE
  v_count stock_counts;
  v_line  RECORD;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_count FROM stock_counts WHERE id = p_stock_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock count % not found', p_stock_count_id;
  END IF;
  IF v_count.status <> 'in_progress' THEN
    RAISE EXCEPTION 'stock count % is not in_progress (status=%)', p_stock_count_id, v_count.status;
  END IF;
  IF v_count.approval_status IS NOT NULL AND v_count.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'stock count % requires approval before finalizing (approval_status=%)', p_stock_count_id, v_count.approval_status;
  END IF;

  FOR v_line IN
    SELECT * FROM stock_count_items
     WHERE stock_count_id = p_stock_count_id AND counted_quantity IS NOT NULL
  LOOP
    UPDATE stock_count_items
       SET variance = v_line.counted_quantity - v_line.expected_quantity
     WHERE id = v_line.id;

    IF v_line.counted_quantity = v_line.expected_quantity THEN
      CONTINUE;
    END IF;

    IF v_line.counted_quantity > v_line.expected_quantity THEN
      v_unit_cost := COALESCE((SELECT cost_price FROM items WHERE id = v_line.item_id), 0);

      v_movement := fn_apply_stock_movement(
        v_count.tenant_id, v_count.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        'count_correction_in', 'in', v_line.counted_quantity - v_line.expected_quantity, v_unit_cost,
        'stock_count', p_stock_count_id, p_actor_id
      );

      PERFORM fn_add_cost_layer(
        v_count.tenant_id, v_count.warehouse_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        v_line.counted_quantity - v_line.expected_quantity, v_unit_cost, v_movement.id
      );
    ELSE
      v_unit_cost := fn_consume_cost_layers(
        v_count.tenant_id, v_count.warehouse_id, v_line.item_id, v_line.variant_id,
        v_line.expected_quantity - v_line.counted_quantity
      );

      PERFORM fn_apply_stock_movement(
        v_count.tenant_id, v_count.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        'count_correction_out', 'out', v_line.expected_quantity - v_line.counted_quantity, v_unit_cost,
        'stock_count', p_stock_count_id, p_actor_id, true
      );
    END IF;
  END LOOP;

  UPDATE stock_counts
     SET status = 'completed', completed_by = p_actor_id, completed_at = NOW()
   WHERE id = p_stock_count_id
   RETURNING * INTO v_count;

  PERFORM _emit_domain_event(
    v_count.tenant_id, 'inventory.stock_count.completed', 'stock_count', v_count.id,
    jsonb_build_object('warehouse_id', v_count.warehouse_id)
  );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
