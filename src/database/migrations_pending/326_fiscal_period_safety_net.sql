-- 326 — WP-B: posting-engine safety net for a missing fiscal year.
--
-- STATUS: PENDING — authored in migrations_pending/ (not scanned by migrate.ts). Applied to the LOCAL
-- disposable database only. It REPLACES a function of the central posting engine, so applying it in
-- production is a separate, explicitly approved stop point (SP-9), after 325 and the dry-run backfill.
--
-- What changes: fn_post_journal_entry (migration 182) is byte-for-byte identical EXCEPT for one block at
-- the period lookup: when no fiscal period covers the posting date it first calls
-- fn_try_extend_fiscal_year() (migration 325) and looks the period up again. Everything else — balance,
-- accounts, book, period status (a closed/locked period is still rejected), immutability, error texts —
-- is unchanged. Grants are preserved by CREATE OR REPLACE.
-- Requires: 325 applied first.

CREATE OR REPLACE FUNCTION fn_post_journal_entry(
  p_tenant_id UUID,
  p_entry_id UUID,
  p_posted_by UUID
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status          TEXT;
  v_book_id         UUID;
  v_posting_date    DATE;
  v_book_status     TEXT;
  v_line_count      INTEGER;
  v_total_debit     NUMERIC(14,2);
  v_total_credit    NUMERIC(14,2);
  v_bad_account_id  UUID;
  v_period_id       UUID;
  v_period_status   TEXT;
BEGIN
  -- Lock the entry row first — a concurrent second call for the same
  -- entry blocks here until this transaction commits or rolls back,
  -- then observes status <> 'draft' and is rejected below.
  SELECT status, accounting_book_id, posting_date
    INTO v_status, v_book_id, v_posting_date
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found for tenant %', p_entry_id, p_tenant_id;
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Journal entry % is not in draft status (current status: %) and cannot be posted', p_entry_id, v_status;
  END IF;

  -- Minimum valid lines: double-entry requires at least 2 lines.
  SELECT count(*), coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
    INTO v_line_count, v_total_debit, v_total_credit
  FROM journal_lines
  WHERE journal_entry_id = p_entry_id AND tenant_id = p_tenant_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % has fewer than 2 lines — a journal entry requires at least one debit and one credit line', p_entry_id;
  END IF;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry % is not balanced: total debit % <> total credit %', p_entry_id, v_total_debit, v_total_credit;
  END IF;

  -- Every referenced account must exist, belong to this tenant, be
  -- active, and be a posting account (not a header/parent account).
  SELECT jl.account_id INTO v_bad_account_id
  FROM journal_lines jl
  LEFT JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = p_tenant_id
  WHERE jl.journal_entry_id = p_entry_id AND jl.tenant_id = p_tenant_id
    AND (a.id IS NULL OR a.is_active = false OR a.is_posting_account = false)
  LIMIT 1;

  IF v_bad_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Journal entry % references an invalid, inactive, or non-posting account %', p_entry_id, v_bad_account_id;
  END IF;

  -- Accounting Book must exist for this tenant and be active. (Its
  -- Accounting Owner/tenant consistency was already guaranteed at
  -- insert time by accounting_books' own composite FK — re-verified
  -- here only for current active status, which can change after the
  -- entry was drafted.)
  SELECT status INTO v_book_status
  FROM accounting_books
  WHERE id = v_book_id AND tenant_id = p_tenant_id;

  IF v_book_status IS NULL THEN
    RAISE EXCEPTION 'Accounting Book % not found for tenant %', v_book_id, p_tenant_id;
  END IF;

  IF v_book_status <> 'active' THEN
    RAISE EXCEPTION 'Accounting Book % is not active and cannot receive postings', v_book_id;
  END IF;

  -- Resolve the Fiscal Period from posting_date and verify it is open.
  SELECT id, status INTO v_period_id, v_period_status
  FROM fiscal_periods
  WHERE tenant_id = p_tenant_id
    AND daterange(start_date, end_date, '[)') @> v_posting_date;

  IF v_period_id IS NULL THEN
    -- WP-B safety net (migration 326): the date is outside every existing period. Try to extend
    -- the calendar by the ONE contiguous next year (never a far-future / past date, never a closed
    -- period, serialised per tenant). The result is ignored on purpose: whether this call created the
    -- year or another session did, the period is simply looked up again; if it still does not exist
    -- the original, unchanged error below is raised and the whole transaction (the sale) rolls back.
    PERFORM fn_try_extend_fiscal_year(p_tenant_id, v_posting_date);
    SELECT id, status INTO v_period_id, v_period_status
    FROM fiscal_periods
    WHERE tenant_id = p_tenant_id
      AND daterange(start_date, end_date, '[)') @> v_posting_date;
  END IF;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No fiscal period covers posting date % for tenant %', v_posting_date, p_tenant_id;
  END IF;

  IF v_period_status <> 'open' THEN
    RAISE EXCEPTION 'Fiscal period % (status=%) is not open — journal entry % cannot be posted into a closed or locked period', v_period_id, v_period_status, p_entry_id;
  END IF;

  -- All invariants hold — atomically transition to posted. The GUC flag
  -- is what the guard trigger checks to accept this specific UPDATE.
  PERFORM set_config('sefay.posting_engine_active', 'true', true);

  UPDATE journal_entries
  SET status = 'posted',
      fiscal_period_id = v_period_id,
      posted_by = p_posted_by,
      posted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;

  PERFORM set_config('sefay.posting_engine_active', 'false', true);

  RETURN p_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ROLLBACK (documented AND exercised locally): restore the migration-182 definition verbatim:
-- CREATE OR REPLACE FUNCTION fn_post_journal_entry(
--   p_tenant_id UUID,
--   p_entry_id UUID,
--   p_posted_by UUID
-- ) RETURNS UUID
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_status          TEXT;
--   v_book_id         UUID;
--   v_posting_date    DATE;
--   v_book_status     TEXT;
--   v_line_count      INTEGER;
--   v_total_debit     NUMERIC(14,2);
--   v_total_credit    NUMERIC(14,2);
--   v_bad_account_id  UUID;
--   v_period_id       UUID;
--   v_period_status   TEXT;
-- BEGIN
--   -- Lock the entry row first — a concurrent second call for the same
--   -- entry blocks here until this transaction commits or rolls back,
--   -- then observes status <> 'draft' and is rejected below.
--   SELECT status, accounting_book_id, posting_date
--     INTO v_status, v_book_id, v_posting_date
--   FROM journal_entries
--   WHERE id = p_entry_id AND tenant_id = p_tenant_id
--   FOR UPDATE;
-- 
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Journal entry % not found for tenant %', p_entry_id, p_tenant_id;
--   END IF;
-- 
--   IF v_status <> 'draft' THEN
--     RAISE EXCEPTION 'Journal entry % is not in draft status (current status: %) and cannot be posted', p_entry_id, v_status;
--   END IF;
-- 
--   -- Minimum valid lines: double-entry requires at least 2 lines.
--   SELECT count(*), coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
--     INTO v_line_count, v_total_debit, v_total_credit
--   FROM journal_lines
--   WHERE journal_entry_id = p_entry_id AND tenant_id = p_tenant_id;
-- 
--   IF v_line_count < 2 THEN
--     RAISE EXCEPTION 'Journal entry % has fewer than 2 lines — a journal entry requires at least one debit and one credit line', p_entry_id;
--   END IF;
-- 
--   IF v_total_debit <> v_total_credit THEN
--     RAISE EXCEPTION 'Journal entry % is not balanced: total debit % <> total credit %', p_entry_id, v_total_debit, v_total_credit;
--   END IF;
-- 
--   -- Every referenced account must exist, belong to this tenant, be
--   -- active, and be a posting account (not a header/parent account).
--   SELECT jl.account_id INTO v_bad_account_id
--   FROM journal_lines jl
--   LEFT JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = p_tenant_id
--   WHERE jl.journal_entry_id = p_entry_id AND jl.tenant_id = p_tenant_id
--     AND (a.id IS NULL OR a.is_active = false OR a.is_posting_account = false)
--   LIMIT 1;
-- 
--   IF v_bad_account_id IS NOT NULL THEN
--     RAISE EXCEPTION 'Journal entry % references an invalid, inactive, or non-posting account %', p_entry_id, v_bad_account_id;
--   END IF;
-- 
--   -- Accounting Book must exist for this tenant and be active. (Its
--   -- Accounting Owner/tenant consistency was already guaranteed at
--   -- insert time by accounting_books' own composite FK — re-verified
--   -- here only for current active status, which can change after the
--   -- entry was drafted.)
--   SELECT status INTO v_book_status
--   FROM accounting_books
--   WHERE id = v_book_id AND tenant_id = p_tenant_id;
-- 
--   IF v_book_status IS NULL THEN
--     RAISE EXCEPTION 'Accounting Book % not found for tenant %', v_book_id, p_tenant_id;
--   END IF;
-- 
--   IF v_book_status <> 'active' THEN
--     RAISE EXCEPTION 'Accounting Book % is not active and cannot receive postings', v_book_id;
--   END IF;
-- 
--   -- Resolve the Fiscal Period from posting_date and verify it is open.
--   SELECT id, status INTO v_period_id, v_period_status
--   FROM fiscal_periods
--   WHERE tenant_id = p_tenant_id
--     AND daterange(start_date, end_date, '[)') @> v_posting_date;
-- 
--   IF v_period_id IS NULL THEN
--     RAISE EXCEPTION 'No fiscal period covers posting date % for tenant %', v_posting_date, p_tenant_id;
--   END IF;
-- 
--   IF v_period_status <> 'open' THEN
--     RAISE EXCEPTION 'Fiscal period % (status=%) is not open — journal entry % cannot be posted into a closed or locked period', v_period_id, v_period_status, p_entry_id;
--   END IF;
-- 
--   -- All invariants hold — atomically transition to posted. The GUC flag
--   -- is what the guard trigger checks to accept this specific UPDATE.
--   PERFORM set_config('sefay.posting_engine_active', 'true', true);
-- 
--   UPDATE journal_entries
--   SET status = 'posted',
--       fiscal_period_id = v_period_id,
--       posted_by = p_posted_by,
--       posted_at = NOW(),
--       updated_at = NOW()
--   WHERE id = p_entry_id AND tenant_id = p_tenant_id;
-- 
--   PERFORM set_config('sefay.posting_engine_active', 'false', true);
-- 
--   RETURN p_entry_id;
-- END;
-- $$ LANGUAGE plpgsql;
