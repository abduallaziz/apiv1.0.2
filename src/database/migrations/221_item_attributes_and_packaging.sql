-- 221. Inventory #2 (Owner-approved, narrow scope) — structured item
-- attributes + multi-level packaging (Piece/Box/Carton/Pallet) + per-level
-- barcode.
--
-- Confirmed via audit: item_variants.name was a single free-text column
-- (e.g. "Red / Large") with zero structured attribute model behind it —
-- genuinely greenfield, not a rebuild.
--
-- Packaging is NOT a second stock truth. stock_levels/stock_movements/
-- cost_layers/fn_apply_stock_movement/fn_consume_cost_layers are untouched
-- by this migration. A packaging level is purely a conversion factor chain
-- down to the item's existing storage_unit_id (item #3, migration 114) —
-- fn_convert_packaging_to_storage_qty resolves a packaging-level quantity
-- into the same storage-unit terms fn_convert_to_storage_unit already
-- produces for purchase/sale units, so every existing reader of stock
-- quantities is unaffected.

-- =============================================================================
-- ATTRIBUTES
-- =============================================================================

CREATE TABLE item_attributes (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_item_attributes_tenant_name ON item_attributes(tenant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE item_attribute_values (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_attribute_id UUID        NOT NULL REFERENCES item_attributes(id) ON DELETE CASCADE,
  value             TEXT        NOT NULL,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_item_attribute_values_attr_value ON item_attribute_values(item_attribute_id, value) WHERE deleted_at IS NULL;

-- Which value a specific variant carries for a specific attribute
-- definition. A variant may have at most one value per attribute
-- (a variant can't be both "Red" and "Blue" for the Color attribute).
CREATE TABLE item_variant_attribute_values (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_variant_id         UUID        NOT NULL REFERENCES item_variants(id) ON DELETE CASCADE,
  item_attribute_id       UUID        NOT NULL REFERENCES item_attributes(id) ON DELETE CASCADE,
  item_attribute_value_id UUID        NOT NULL REFERENCES item_attribute_values(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_variant_attribute ON item_variant_attribute_values(item_variant_id, item_attribute_id);

ALTER TABLE item_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_attributes
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE item_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_attribute_values
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE item_variant_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_variant_attribute_values
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL ON item_attributes, item_attribute_values, item_variant_attribute_values TO service_role;

-- =============================================================================
-- PACKAGING LEVELS
-- =============================================================================

-- A chain of levels per item, each expressed as a quantity of its
-- immediate parent (Carton.quantity_in_parent=12 means 1 Carton = 12 of
-- whatever its parent level is — e.g. Box). The level with
-- parent_level_id IS NULL is the root and is defined as exactly 1 unit of
-- the item's existing storage_unit_id — it is a label only, not a second
-- quantity source.
CREATE TABLE item_packaging_levels (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  parent_level_id    UUID          REFERENCES item_packaging_levels(id) ON DELETE CASCADE,
  level_name         TEXT          NOT NULL,
  quantity_in_parent NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (quantity_in_parent > 0),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_root_quantity_is_one CHECK (parent_level_id IS NOT NULL OR quantity_in_parent = 1)
);
CREATE UNIQUE INDEX uq_item_packaging_level_name ON item_packaging_levels(item_id, level_name);
CREATE INDEX idx_item_packaging_levels_item ON item_packaging_levels(item_id);
CREATE INDEX idx_item_packaging_levels_parent ON item_packaging_levels(parent_level_id) WHERE parent_level_id IS NOT NULL;

-- Exactly one root level per item (the storage-unit-equivalent anchor).
CREATE UNIQUE INDEX uq_item_packaging_root ON item_packaging_levels(item_id) WHERE parent_level_id IS NULL;

ALTER TABLE item_packaging_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_packaging_levels
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL ON item_packaging_levels TO service_role;

-- Barcode-per-packaging-level. NULL = existing unit/variant barcode,
-- unchanged behavior. Non-NULL means scanning this barcode represents
-- that many storage units, resolved via fn_convert_packaging_to_storage_qty
-- below rather than assumed to be a single storage unit.
ALTER TABLE item_barcodes ADD COLUMN packaging_level_id UUID REFERENCES item_packaging_levels(id) ON DELETE CASCADE;
CREATE INDEX idx_item_barcodes_packaging_level ON item_barcodes(packaging_level_id) WHERE packaging_level_id IS NOT NULL;

-- Resolves a quantity of a given packaging level into the item's
-- storage-unit-equivalent quantity, by walking the parent chain and
-- multiplying quantity_in_parent at each hop. Raises rather than guessing
-- if the level doesn't belong to the item, mirroring
-- fn_convert_to_storage_unit's own no-guessing rule (114).
CREATE OR REPLACE FUNCTION fn_convert_packaging_to_storage_qty(
  p_item_id            UUID,
  p_packaging_level_id UUID,
  p_quantity           NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_level    item_packaging_levels;
  v_factor   NUMERIC := 1;
  v_guard    INTEGER := 0;
BEGIN
  IF p_packaging_level_id IS NULL THEN
    RETURN p_quantity;
  END IF;

  SELECT * INTO v_level FROM item_packaging_levels WHERE id = p_packaging_level_id;
  IF NOT FOUND OR v_level.item_id <> p_item_id THEN
    RAISE EXCEPTION 'packaging level % is not configured for item %', p_packaging_level_id, p_item_id;
  END IF;

  WHILE v_level.parent_level_id IS NOT NULL LOOP
    v_factor := v_factor * v_level.quantity_in_parent;
    SELECT * INTO v_level FROM item_packaging_levels WHERE id = v_level.parent_level_id;
    v_guard := v_guard + 1;
    IF v_guard > 20 THEN
      RAISE EXCEPTION 'packaging level chain for item % exceeds maximum depth — possible cycle', p_item_id;
    END IF;
  END LOOP;

  RETURN p_quantity * v_factor;
END;
$$ LANGUAGE plpgsql STABLE;
