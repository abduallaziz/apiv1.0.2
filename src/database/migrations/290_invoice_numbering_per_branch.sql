-- 290_invoice_numbering_per_branch.sql  (Branch isolation P3 - docs/DESIGN_BRANCH_ISOLATION.md D6)
-- Per-branch invoice numbering. ADDITIVE and backward compatible:
--  * the existing 3-argument fn_next_invoice_no(uuid,text,integer) and the tenant counter in
--    invoice_sequences are NOT touched: callers that do not know a branch (flag off) behave exactly as before;
--  * new 4-argument overload fn_next_invoice_no(uuid,text,integer,uuid) (the 4th parameter has NO default, so a
--    3-argument call can never become ambiguous - see the Postgres function overload gotcha):
--      - p_branch_id NULL, or the tenant has no main branch, or p_branch_id IS the main branch
--          -> delegates to the 3-argument function = the main branch keeps continuing the tenant counter;
--      - any other branch -> its own counter in invoice_branch_sequences, number = prefix || <6 hex of the
--        branch id> || '-' || zero-padded counter (e.g. INV-3F9A1C-000001). orders (tenant_id, invoice_no)
--        stays unique, so a prefix collision can never silently duplicate a legal number.
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP FUNCTION IF EXISTS fn_next_invoice_no(uuid,text,integer,uuid);
--           DROP TABLE IF EXISTS invoice_branch_sequences;

CREATE TABLE IF NOT EXISTS invoice_branch_sequences (
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID        NOT NULL REFERENCES branches(id),
  series      TEXT        NOT NULL DEFAULT 'default',
  last_value  BIGINT      NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, branch_id, series)
);

ALTER TABLE invoice_branch_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON invoice_branch_sequences;
CREATE POLICY tenant_session_isolation ON invoice_branch_sequences
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.invoice_branch_sequences TO service_role;

CREATE OR REPLACE FUNCTION fn_next_invoice_no(
  p_tenant_id UUID,
  p_prefix    TEXT,
  p_padding   INTEGER,
  p_branch_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_main UUID;
  v_n    BIGINT;
BEGIN
  IF p_branch_id IS NOT NULL THEN
    SELECT id INTO v_main
      FROM branches
     WHERE tenant_id = p_tenant_id AND is_main AND deleted_at IS NULL
     LIMIT 1;
  END IF;

  -- main branch (or no branch / no main yet): the legacy tenant-wide counter
  IF p_branch_id IS NULL OR v_main IS NULL OR p_branch_id = v_main THEN
    RETURN fn_next_invoice_no(p_tenant_id, p_prefix, p_padding);
  END IF;

  INSERT INTO invoice_branch_sequences (tenant_id, branch_id, series, last_value)
  VALUES (p_tenant_id, p_branch_id, 'default', 1)
  ON CONFLICT (tenant_id, branch_id, series)
  DO UPDATE SET last_value = invoice_branch_sequences.last_value + 1, updated_at = NOW()
  RETURNING last_value INTO v_n;

  RETURN COALESCE(p_prefix, '')
      || upper(substr(replace(p_branch_id::text, '-', ''), 1, 6)) || '-'
      || lpad(v_n::text, GREATEST(COALESCE(p_padding, 6), 1), '0');
END;
$$;

REVOKE ALL ON FUNCTION fn_next_invoice_no(UUID, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_next_invoice_no(UUID, TEXT, INTEGER, UUID) TO service_role;
