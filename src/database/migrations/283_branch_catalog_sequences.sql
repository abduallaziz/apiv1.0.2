-- 283_branch_catalog_sequences.sql  (Branch isolation P1 / Task 1 - D5)
-- SKU and barcode counters become per branch: key (tenant_id, branch_id), legacy/tenant-wide counter = nil uuid.
-- Existing function signatures fn_next_sku_seq(uuid) / fn_next_barcode_seq(uuid) are REPLACED in place (same signature,
-- no overload: see the Postgres function overload gotcha) and keep working on the nil-branch row, so flag-off tenants
-- are unaffected. New fn_next_branch_sku_seq / fn_next_branch_barcode_seq take the branch. A branch's FIRST number:
-- the MAIN branch continues from the legacy counter (its existing items were numbered by it); other branches start at 1.
-- item_variant_sku_sequences is keyed by (tenant_id, item_id) and items are branch-owned, so it is already per branch.
-- ROLLBACK: restore the 101/139 definitions of the two functions, drop the two new functions, then
--   DELETE the non-nil rows and re-create PKs on (tenant_id) for tenant_sku_sequences / tenant_barcode_sequences.

ALTER TABLE tenant_sku_sequences     ADD COLUMN IF NOT EXISTS branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE tenant_barcode_sequences ADD COLUMN IF NOT EXISTS branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

DO $$
DECLARE v_t TEXT;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['tenant_sku_sequences', 'tenant_barcode_sequences'] LOOP
    -- swap PK (tenant_id) -> (tenant_id, branch_id) only once
    IF (SELECT count(*) FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
         WHERE i.indrelid = format('public.%I', v_t)::regclass AND i.indisprimary) = 1 THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_t, v_t || '_pkey');
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (tenant_id, branch_id)', v_t);
    END IF;
  END LOOP;
END $$;

-- legacy signatures: operate on the nil-branch row
CREATE OR REPLACE FUNCTION fn_next_sku_seq(p_tenant_id UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO tenant_sku_sequences (tenant_id, branch_id, next_seq)
  VALUES (p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid, 2)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET next_seq = tenant_sku_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END; $$;

CREATE OR REPLACE FUNCTION fn_next_barcode_seq(p_tenant_id UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO tenant_barcode_sequences (tenant_id, branch_id, next_seq)
  VALUES (p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid, 2)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET next_seq = tenant_barcode_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END; $$;

CREATE OR REPLACE FUNCTION fn_next_branch_sku_seq(p_tenant_id UUID, p_branch_id UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_seq   BIGINT;
  v_nil   CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  v_start BIGINT := 1;
BEGIN
  IF p_branch_id IS NULL OR p_branch_id = v_nil THEN
    RETURN fn_next_sku_seq(p_tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND tenant_id = p_tenant_id AND is_main) THEN
    SELECT COALESCE(max(next_seq), 1) INTO v_start
      FROM tenant_sku_sequences WHERE tenant_id = p_tenant_id AND branch_id = v_nil;
  END IF;
  INSERT INTO tenant_sku_sequences (tenant_id, branch_id, next_seq)
  VALUES (p_tenant_id, p_branch_id, v_start + 1)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET next_seq = tenant_sku_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END; $$;

CREATE OR REPLACE FUNCTION fn_next_branch_barcode_seq(p_tenant_id UUID, p_branch_id UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_seq   BIGINT;
  v_nil   CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  v_start BIGINT := 1;
BEGIN
  IF p_branch_id IS NULL OR p_branch_id = v_nil THEN
    RETURN fn_next_barcode_seq(p_tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND tenant_id = p_tenant_id AND is_main) THEN
    SELECT COALESCE(max(next_seq), 1) INTO v_start
      FROM tenant_barcode_sequences WHERE tenant_id = p_tenant_id AND branch_id = v_nil;
  END IF;
  INSERT INTO tenant_barcode_sequences (tenant_id, branch_id, next_seq)
  VALUES (p_tenant_id, p_branch_id, v_start + 1)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET next_seq = tenant_barcode_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END; $$;

GRANT EXECUTE ON FUNCTION fn_next_sku_seq(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_barcode_seq(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_branch_sku_seq(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_branch_barcode_seq(UUID, UUID) TO service_role;
