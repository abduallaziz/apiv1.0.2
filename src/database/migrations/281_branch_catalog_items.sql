-- 281_branch_catalog_items.sql  (Branch isolation P1 / Task 1 - docs/DESIGN_BRANCH_ISOLATION.md D4, D5)
-- Catalog tables become branch-owned (one row per branch). ADDITIVE: new nullable branch_id columns + indexes.
-- Behaviour changes only for tenants with branch_isolation_enabled = true. Legacy NULL-branch rows keep today's
-- tenant-wide uniqueness through COALESCE(branch_id, nil uuid) in the new unique indexes. The old tenant-wide
-- unique indexes are dropped only AFTER the new ones exist (a row set unique per tenant is unique per branch).
-- Child tables WITHOUT their own column inherit the branch from their parent: item_attribute_values (attribute),
-- item_variant_attribute_values (variant), item_packaging_levels (item).
-- ROLLBACK:
--   recreate the old unique indexes (uq_items_tenant_sku, uq_item_variants_tenant_sku, uq_item_barcodes_tenant_barcode,
--   uq_item_attributes_tenant_name), then DROP the new ones (uq_*_branch_*) and optionally
--   ALTER TABLE <t> DROP COLUMN branch_id; DELETE FROM branch_isolation_tables WHERE table_name IN (...).

ALTER TABLE items           ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE item_variants   ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE item_barcodes   ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE categories      ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE brands          ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE units           ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE item_attributes ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_items_tenant_branch           ON items (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_variants_tenant_branch   ON item_variants (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_item_barcodes_tenant_branch   ON item_barcodes (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_branch      ON categories (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_brands_tenant_branch          ON brands (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_units_tenant_branch           ON units (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_item_attributes_tenant_branch ON item_attributes (tenant_id, branch_id);

-- D5: per-branch uniqueness. Create the branch-scoped indexes first ...
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_branch_sku
  ON items (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), sku)
  WHERE sku IS NOT NULL AND sku != '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_variants_branch_sku
  ON item_variants (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), sku)
  WHERE sku IS NOT NULL AND sku != '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_barcodes_branch_barcode
  ON item_barcodes (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), barcode);

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_attributes_branch_name
  ON item_attributes (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE deleted_at IS NULL;

-- ... then drop the tenant-wide ones they supersede.
DROP INDEX IF EXISTS uq_items_tenant_sku;
DROP INDEX IF EXISTS uq_item_variants_tenant_sku;
DROP INDEX IF EXISTS uq_item_barcodes_tenant_barcode;
DROP INDEX IF EXISTS uq_item_attributes_tenant_name;

-- Enabling isolation assigns every NULL-branch row of these tables to the tenant's main branch.
INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('items', 'catalog (task 1)'),
  ('item_variants', 'catalog (task 1)'),
  ('item_barcodes', 'catalog (task 1)'),
  ('categories', 'catalog (task 1)'),
  ('brands', 'catalog (task 1)'),
  ('units', 'catalog (task 1)'),
  ('item_attributes', 'catalog (task 1)')
ON CONFLICT (table_name) DO NOTHING;
