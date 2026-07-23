-- =============================================================================
-- 098 — Item barcodes (multi-barcode support) + expanded items.type taxonomy
-- =============================================================================
-- Inventory Redesign Phase 2. Two independent, additive changes:
--
-- 1) item_barcodes: new table, one-to-many with items/item_variants. A
--    barcode physically identifies exactly one product/variant when
--    scanned, so uniqueness is scoped per-tenant on the barcode value
--    itself (not "per item" — a barcode belonging to two different items
--    would be a real data error, not a valid state).
--
-- 2) items.type: widens the EXISTING CHECK constraint (items_type_check,
--    currently 'product'|'service'|'custom') to add 5 new values. All 3
--    existing values are kept — 'custom' has zero rows in production
--    today but dropping an already-allowed value isn't necessary to reach
--    the target list, so it stays for zero migration risk. No existing row
--    needs to change: production currently only has 'product'/'service'
--    rows, both already valid before and after this migration.
-- =============================================================================

CREATE TABLE item_barcodes (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id   UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  barcode      TEXT        NOT NULL,
  barcode_type TEXT        NOT NULL DEFAULT 'UPC' CHECK (barcode_type IN ('UPC', 'EAN', 'GS1', 'QR')),
  is_primary   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A barcode value must resolve to exactly one item/variant within a tenant.
CREATE UNIQUE INDEX uq_item_barcodes_tenant_barcode ON item_barcodes(tenant_id, barcode);
CREATE INDEX idx_item_barcodes_item ON item_barcodes(item_id);
CREATE INDEX idx_item_barcodes_variant ON item_barcodes(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE item_barcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_barcodes
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE items
  DROP CONSTRAINT items_type_check;

ALTER TABLE items
  ADD CONSTRAINT items_type_check
  CHECK (type IN (
    'product', 'service', 'custom',
    'raw_material', 'semi_finished', 'finished_goods', 'asset', 'consumable'
  ));
