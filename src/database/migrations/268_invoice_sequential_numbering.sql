-- 268_invoice_sequential_numbering.sql
-- Sequential invoice numbers (ZATCA: consecutive, unique, no gaps). Until now the shown number was
-- the last 6 characters of the order UUID (random, not sequential).
--
--  * orders.invoice_no: the legal number (e.g. INV-000123). NULL for orders created before this
--    migration (they keep showing the short id; they are NOT renumbered retroactively).
--  * invoice_sequences: one counter per tenant (and series, 'default' for now).
--  * fn_next_invoice_no(): takes the next number ATOMICALLY. It is called inside the sale's own
--    transaction, so a failed sale rolls the counter back with it -> no gaps; concurrent sales of
--    the same tenant are serialised by the row lock taken by the UPDATE -> no duplicates.
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP FUNCTION fn_next_invoice_no; DROP TABLE invoice_sequences;
--           DROP INDEX uq_orders_tenant_invoice_no; ALTER TABLE orders DROP COLUMN invoice_no.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_no TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tenant_invoice_no
  ON orders (tenant_id, invoice_no)
  WHERE invoice_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_sequences (
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  series      TEXT        NOT NULL DEFAULT 'default',
  last_value  BIGINT      NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, series)
);

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON invoice_sequences;
CREATE POLICY tenant_session_isolation ON invoice_sequences
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.invoice_sequences TO service_role;

-- Next number for the tenant, formatted prefix || zero-padded counter.
CREATE OR REPLACE FUNCTION fn_next_invoice_no(
  p_tenant_id UUID,
  p_prefix    TEXT DEFAULT 'INV-',
  p_padding   INTEGER DEFAULT 6
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n BIGINT;
BEGIN
  -- First sale creates the counter at 1; every later one increments it under the row lock.
  INSERT INTO invoice_sequences (tenant_id, series, last_value)
  VALUES (p_tenant_id, 'default', 1)
  ON CONFLICT (tenant_id, series)
  DO UPDATE SET last_value = invoice_sequences.last_value + 1, updated_at = NOW()
  RETURNING last_value INTO v_n;

  RETURN COALESCE(p_prefix, '') || lpad(v_n::text, GREATEST(COALESCE(p_padding, 6), 1), '0');
END;
$$;

REVOKE ALL ON FUNCTION fn_next_invoice_no(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_next_invoice_no(UUID, TEXT, INTEGER) TO service_role;
