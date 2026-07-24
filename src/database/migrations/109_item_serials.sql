-- Inventory redesign — Part A item #14: dedicated serial-number tracking.
--
-- Today serial_number is just a column bolted onto item_batches (same
-- table as batch/lot tracking), with no status lifecycle, no warranty,
-- no link to which sale a unit went out on. This is a genuinely separate
-- table per unit, not a repurposing of item_batches (which stays exactly
-- as-is — its serial_number column is now legacy/frozen, same convention
-- as items.cost_price elsewhere in this codebase: never written to by
-- new code, read-only for historical rows).
CREATE TABLE item_serials (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id            UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id         UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  batch_id           UUID        REFERENCES item_batches(id) ON DELETE SET NULL,
  warehouse_id       UUID        REFERENCES warehouses(id) ON DELETE SET NULL,
  serial_number      TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'returned', 'scrapped')),
  warranty_months    INTEGER     CHECK (warranty_months >= 0),
  warranty_expires_at DATE,
  sold_order_id      UUID        REFERENCES orders(id) ON DELETE SET NULL,
  sold_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_item_serials_tenant_number ON item_serials(tenant_id, item_id, serial_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_item_serials_status ON item_serials(tenant_id, item_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_item_serials_order ON item_serials(tenant_id, sold_order_id) WHERE sold_order_id IS NOT NULL;

ALTER TABLE item_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_serials
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.item_serials TO service_role;

-- Backfill: real existing serial_number rows on item_batches become real
-- rows here (additive only — item_batches itself is untouched). Assumed
-- 'in_stock' since there's no existing status/order-linkage data to infer
-- 'sold' from.
INSERT INTO item_serials (tenant_id, item_id, variant_id, batch_id, serial_number, status)
SELECT tenant_id, item_id, variant_id, id, serial_number, 'in_stock'
FROM item_batches
WHERE serial_number IS NOT NULL;

-- Marks a serial unit sold, linked to the real order, and computes
-- warranty_expires_at from warranty_months if the item defines one.
CREATE OR REPLACE FUNCTION fn_sell_serial(
  p_serial_id UUID,
  p_order_id  UUID,
  p_warranty_months INTEGER DEFAULT NULL
) RETURNS item_serials AS $$
DECLARE
  v_serial item_serials;
BEGIN
  SELECT * INTO v_serial FROM item_serials WHERE id = p_serial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'serial % not found', p_serial_id;
  END IF;
  IF v_serial.status <> 'in_stock' THEN
    RAISE EXCEPTION 'serial % is not in_stock (status=%)', p_serial_id, v_serial.status;
  END IF;

  UPDATE item_serials
     SET status = 'sold',
         sold_order_id = p_order_id,
         sold_at = NOW(),
         warranty_months = COALESCE(p_warranty_months, warranty_months),
         warranty_expires_at = CASE
           WHEN COALESCE(p_warranty_months, warranty_months) IS NOT NULL
           THEN (NOW() + (COALESCE(p_warranty_months, warranty_months) || ' months')::INTERVAL)::DATE
           ELSE warranty_expires_at
         END,
         updated_at = NOW()
   WHERE id = p_serial_id
   RETURNING * INTO v_serial;

  RETURN v_serial;
END;
$$ LANGUAGE plpgsql;

-- Customer return: back to in_stock (sellable again) — a real business
-- decision (some tenants may want 'scrapped' instead for certain returns)
-- is left to the caller; this just handles the common "returned, back on
-- the shelf" path.
CREATE OR REPLACE FUNCTION fn_return_serial(
  p_serial_id UUID
) RETURNS item_serials AS $$
DECLARE
  v_serial item_serials;
BEGIN
  SELECT * INTO v_serial FROM item_serials WHERE id = p_serial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'serial % not found', p_serial_id;
  END IF;
  IF v_serial.status <> 'sold' THEN
    RAISE EXCEPTION 'serial % is not sold (status=%)', p_serial_id, v_serial.status;
  END IF;

  UPDATE item_serials
     SET status = 'returned',
         updated_at = NOW()
   WHERE id = p_serial_id
   RETURNING * INTO v_serial;

  RETURN v_serial;
END;
$$ LANGUAGE plpgsql;
