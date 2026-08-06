-- Phase 3 — SKU Auto Generation.
--
-- SKU is a fully separate identity system from item_barcodes (101/ean13.util.ts)
-- — different format, different sequence tables, no shared state. Mirrors the
-- barcode sequence's UPSERT...RETURNING pattern (atomic under Postgres row
-- locking) rather than a count()-based approach, which is not concurrency-safe
-- (two concurrent inserts can read the same count() before either commits —
-- already a known bug class elsewhere in this codebase, not repeating it here).

ALTER TABLE items
  ADD COLUMN sku_source TEXT NOT NULL DEFAULT 'auto' CHECK (sku_source IN ('auto', 'manual'));

ALTER TABLE item_variants
  ADD COLUMN sku_source TEXT NOT NULL DEFAULT 'auto' CHECK (sku_source IN ('auto', 'manual'));

-- SKU is an ERP identity, not a display label — once assigned within a
-- tenant it must never be recyclable by a later item/variant, including
-- after the original is soft-deleted/deactivated. No deleted_at/is_active
-- filter here (deliberately stricter than the item_barcodes uniqueness
-- pattern, which does allow reuse after delete).
CREATE UNIQUE INDEX uq_items_tenant_sku
  ON items(tenant_id, sku)
  WHERE sku IS NOT NULL AND sku != '';

CREATE UNIQUE INDEX uq_item_variants_tenant_sku
  ON item_variants(tenant_id, sku)
  WHERE sku IS NOT NULL AND sku != '';

-- Per-tenant atomic sequence for product SKUs (0000001, 0000002, ...).
CREATE TABLE tenant_sku_sequences (
  tenant_id  UUID    PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_seq   BIGINT  NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION fn_next_sku_seq(p_tenant_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO tenant_sku_sequences (tenant_id, next_seq)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_seq = tenant_sku_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  RETURN v_seq;
END;
$$;

-- Per-(tenant, item) atomic sequence for variant SKU suffixes (-01, -02, ...).
-- Composite PK keyed by tenant_id + item_id — item_id alone would already be
-- tenant-unique in practice (items.id is a UUID owned by exactly one tenant),
-- but the explicit tenant_id column and composite key make that isolation
-- structural rather than incidental, matching the review requirement.
CREATE TABLE item_variant_sku_sequences (
  tenant_id  UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id    UUID    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  next_seq   BIGINT  NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, item_id)
);

CREATE OR REPLACE FUNCTION fn_next_variant_sku_seq(p_tenant_id UUID, p_item_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO item_variant_sku_sequences (tenant_id, item_id, next_seq)
  VALUES (p_tenant_id, p_item_id, 2)
  ON CONFLICT (tenant_id, item_id)
  DO UPDATE SET next_seq = item_variant_sku_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  RETURN v_seq;
END;
$$;

-- No RLS needed — these tables are never queried directly by tenant-scoped
-- repositories (only through the SECURITY INVOKER functions above, called
-- with an explicit tenant_id argument from already-authenticated requests).
GRANT ALL PRIVILEGES ON public.tenant_sku_sequences TO service_role;
GRANT ALL PRIVILEGES ON public.item_variant_sku_sequences TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_sku_seq(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_variant_sku_seq(UUID, UUID) TO service_role;
