-- =============================================================================
-- 007: Fix order_items.item_id / variant_id FK to ON DELETE SET NULL
-- Context: order_items.item_id and variant_id had no ON DELETE action
-- (defaults to RESTRICT). Discovered while hard-deleting a QA test tenant via
-- service-role: DELETE FROM tenants cascades to items (tenants→items CASCADE)
-- but order_items still referenced those items, so Postgres blocked the
-- items delete with a FK violation. SET NULL (not CASCADE) is correct here —
-- deleting a product must not delete historical order line records, per the
-- "financial records immutable" rule. Both columns are already nullable.
-- =============================================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE rel.relname = 'order_items'
    AND con.contype = 'f'
    AND att.attname = 'item_id';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE order_items DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE rel.relname = 'order_items'
    AND con.contype = 'f'
    AND att.attname = 'variant_id';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE order_items DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_variant_id_fkey
  FOREIGN KEY (variant_id) REFERENCES item_variants(id) ON DELETE SET NULL;
