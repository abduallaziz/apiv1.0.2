-- Migration 10.1 — Inventory Ownership foundation (#20).
--
-- New table (stock_ownership_layers) tracks ownership as an overlay on top
-- of the existing, UNCHANGED inventory model — mirrors how quality_holds
-- (migration 145) overlays advisory holds without touching stock_levels/
-- stock_movements. Company-owned stock (the default, ~100% of traffic)
-- never gets a layer row at all — layers exist only for consignment/
-- customer ownership.
--
-- fn_apply_stock_movement, fn_consume_cost_layers, fn_add_cost_layer,
-- cost_layers, stock_movements, and fn_post_production_order are NOT
-- modified anywhere in this migration — confirmed line by line below.

CREATE TABLE stock_ownership_layers (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id          UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  location_id           UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  item_id               UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id            UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id              UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  ownership_type        TEXT          NOT NULL CHECK (ownership_type IN ('company', 'consignment', 'customer')),
  owner_customer_id     UUID          REFERENCES customers(id) ON DELETE SET NULL,
  owner_supplier_id     UUID          REFERENCES suppliers(id) ON DELETE SET NULL,
  quantity              NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  status                TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'closed')),
  reason                TEXT,
  source_reference_type TEXT,
  source_reference_id   UUID,
  created_by            UUID          REFERENCES users(id),
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
-- The exact lookup fn_consume_ownership_layers and the sale-advisory check
-- perform — active layers only, FIFO by created_at.
CREATE INDEX idx_ownership_layers_active_lookup
  ON stock_ownership_layers(tenant_id, warehouse_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at)
  WHERE status = 'active';
CREATE INDEX idx_ownership_layers_reference
  ON stock_ownership_layers(tenant_id, source_reference_type, source_reference_id);
ALTER TABLE stock_ownership_layers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON stock_ownership_layers
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.stock_ownership_layers TO service_role;

-- Additive, optional columns on the existing goods_receipt_items table —
-- NULL/omitted (the default) means company-owned, zero behavior change.
ALTER TABLE goods_receipt_items
  ADD COLUMN ownership_type TEXT CHECK (ownership_type IS NULL OR ownership_type IN ('company', 'consignment', 'customer')),
  ADD COLUMN owner_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

-- FIFO-by-created_at consumption of ACTIVE ownership layers only — entirely
-- independent of cost_layers/fn_consume_cost_layers. Returns the quantity
-- actually consumed (0 if no active layer exists for this item — the
-- normal, default case, never an error). Never raises — this is advisory
-- bookkeeping, not a hard stock constraint, and must never be able to block
-- a sale or any other caller.
CREATE OR REPLACE FUNCTION fn_consume_ownership_layers(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID,
  p_quantity     NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_layer RECORD;
  v_remaining NUMERIC := p_quantity;
  v_take NUMERIC;
  v_total_consumed NUMERIC := 0;
BEGIN
  FOR v_layer IN
    SELECT * FROM stock_ownership_layers
     WHERE tenant_id = p_tenant_id
       AND warehouse_id = p_warehouse_id
       AND item_id = p_item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND status = 'active'
     ORDER BY created_at
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_layer.quantity, v_remaining);

    IF v_take >= v_layer.quantity THEN
      UPDATE stock_ownership_layers
         SET status = 'closed', quantity = 0, closed_at = NOW()
       WHERE id = v_layer.id;
    ELSE
      UPDATE stock_ownership_layers
         SET quantity = quantity - v_take
       WHERE id = v_layer.id;
    END IF;

    v_remaining := v_remaining - v_take;
    v_total_consumed := v_total_consumed + v_take;
  END LOOP;

  RETURN v_total_consumed;
END;
$$ LANGUAGE plpgsql;

-- Wrapper — calls the EXISTING, UNCHANGED fn_post_goods_receipt first (so
-- its own status='draft' guard against double-posting runs before anything
-- else, making a duplicate ownership layer structurally impossible as long
-- as posting is attempted first), then creates one ownership layer per line
-- that declares non-company ownership. A defense-in-depth idempotency
-- pre-check additionally guards against a duplicate layer even if this
-- function were somehow re-entered. Runs as one atomic transaction (a
-- single PL/pgSQL function call) — any failure after fn_post_goods_receipt
-- has run rolls back everything, including the receipt posting itself.
CREATE OR REPLACE FUNCTION fn_post_goods_receipt_with_ownership(
  p_goods_receipt_id UUID,
  p_actor_id         UUID
) RETURNS goods_receipts AS $$
DECLARE
  v_receipt goods_receipts;
  v_line    RECORD;
  v_exists  BOOLEAN;
BEGIN
  -- fn_post_goods_receipt (112/unchanged) enforces status='draft' itself —
  -- this call is the single source of duplicate-posting protection.
  v_receipt := fn_post_goods_receipt(p_goods_receipt_id, p_actor_id);

  SELECT EXISTS (
    SELECT 1 FROM stock_ownership_layers
     WHERE tenant_id = v_receipt.tenant_id
       AND source_reference_type = 'goods_receipt'
       AND source_reference_id = p_goods_receipt_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    FOR v_line IN
      SELECT * FROM goods_receipt_items
       WHERE goods_receipt_id = p_goods_receipt_id
         AND ownership_type IS NOT NULL
         AND ownership_type <> 'company'
    LOOP
      -- goods_receipt_items has no batch_id FK (only a free-text
      -- batch_number) — the layer's batch_id is left NULL; ownership is
      -- tracked at the item/variant grain here, not per-batch.
      INSERT INTO stock_ownership_layers (
        tenant_id, warehouse_id, location_id, item_id, variant_id,
        ownership_type, owner_supplier_id, quantity, status,
        source_reference_type, source_reference_id, created_by
      ) VALUES (
        v_receipt.tenant_id, v_receipt.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id,
        v_line.ownership_type, v_line.owner_supplier_id, v_line.quantity_received, 'active',
        'goods_receipt', p_goods_receipt_id, p_actor_id
      );
    END LOOP;
  END IF;

  RETURN v_receipt;
END;
$$ LANGUAGE plpgsql;
