-- Inventory/Products Phase 2 continuation — Supplier Sync foundation.
--
-- No supplier catalog/barcode data or external supplier integration exists
-- anywhere in the codebase today (confirmed: suppliers table only has
-- name/email/contact fields). This table is the landing zone for
-- supplier-provided item/barcode mappings — populated today via the same
-- CSV import path as item_barcodes, and by a future live connector without
-- schema changes. A row here does NOT become a real barcode automatically;
-- it is explicitly "synced" into item_barcodes via a dedicated endpoint,
-- so a bad supplier feed can never corrupt the real catalog silently.
--
-- Learning from migrations 099/100 (two separate live 500s caused by a new
-- table missing service_role grants and missing deleted_at): both are
-- included from the start here.
CREATE TABLE supplier_catalog (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id   UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  item_id       UUID        REFERENCES items(id) ON DELETE CASCADE,
  variant_id    UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  catalog_code  TEXT,
  barcode       TEXT        NOT NULL,
  barcode_type  TEXT        NOT NULL DEFAULT 'EAN' CHECK (barcode_type IN ('UPC', 'EAN', 'GS1', 'QR')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_supplier_catalog_tenant ON supplier_catalog(tenant_id);
CREATE INDEX idx_supplier_catalog_supplier ON supplier_catalog(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_supplier_catalog_item ON supplier_catalog(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_supplier_catalog_barcode ON supplier_catalog(tenant_id, barcode);

ALTER TABLE supplier_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON supplier_catalog
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.supplier_catalog TO service_role;
