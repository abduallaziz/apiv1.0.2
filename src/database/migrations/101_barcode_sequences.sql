-- Inventory/Products Phase 2 continuation — Barcode Automation.
--
-- Backs auto-generated barcodes (item/variant creation with no barcode
-- supplied) with a real per-tenant atomic sequence, not the count()-based
-- estimate used by invoices.repository.ts (which is not concurrency-safe
-- — two concurrent inserts can read the same count() before either commits).
-- A single UPSERT...RETURNING is atomic under Postgres row locking, so
-- concurrent callers for the same tenant serialize correctly here.
CREATE TABLE tenant_barcode_sequences (
  tenant_id  UUID    PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_seq   BIGINT  NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION fn_next_barcode_seq(p_tenant_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO tenant_barcode_sequences (tenant_id, next_seq)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_seq = tenant_barcode_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  RETURN v_seq;
END;
$$;

-- No RLS needed — this table is never queried directly by tenant-scoped
-- repositories (only through the SECURITY INVOKER function above, called
-- with an explicit tenant_id argument from already-authenticated requests).
-- Still applying the same grant discipline that 099 had to fix retroactively.
GRANT ALL PRIVILEGES ON public.tenant_barcode_sequences TO service_role;
GRANT EXECUTE ON FUNCTION fn_next_barcode_seq(UUID) TO service_role;
