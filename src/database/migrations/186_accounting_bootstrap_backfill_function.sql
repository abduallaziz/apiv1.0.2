-- 186 — Accounting Bootstrap Backfill function (Phase 3, approved 2026-08-11)
-- "Approved – Proceed with Implementation". Scope = Phase 3 backfill scope
-- Option B (13 named tenants, explicit allowlist enforced by the caller
-- script, not by this function) + historical-orders Option A (this
-- function creates ZERO journal entries and never touches `orders` —
-- configuration only, exactly mirroring AccountingBootstrapService's
-- runtime inserts so a backfilled tenant is byte-for-byte identical to one
-- bootstrapped at registration).
--
-- This function does NOT modify M176-M184. It only INSERTs into tables
-- those migrations already created, using the same values
-- accounting-bootstrap.service.ts uses for new tenants.
--
-- Idempotency: hard gate at the top — if this tenant already has any
-- accounting_owners row, the function returns 'SKIPPED_ALREADY_CONFIGURED'
-- immediately without inserting anything else, so a partially-run backfill
-- can always be safely re-invoked.
--
-- Atomicity: a single function call is Postgres's own transaction boundary
-- — any RAISE EXCEPTION below rolls back every insert this invocation made
-- for this tenant, with zero effect on any other tenant. This is what
-- gives "one tenant = one PostgreSQL transaction" without a raw pg client.

CREATE OR REPLACE FUNCTION fn_backfill_accounting_bootstrap(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_branch_id    UUID;
  v_branch_name  TEXT;
  v_owner_id     UUID;
  v_book_id      UUID;
  v_calendar_id  UUID;
  v_year         INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  v_year_label   TEXT := EXTRACT(YEAR FROM NOW())::TEXT;
BEGIN
  -- Hard idempotency gate.
  IF EXISTS (SELECT 1 FROM accounting_owners WHERE tenant_id = p_tenant_id) THEN
    RETURN 'SKIPPED_ALREADY_CONFIGURED';
  END IF;

  -- Anchor branch: earliest-created active branch for this tenant, same
  -- role the just-created branch plays in AuthService.register()'s live
  -- bootstrap call.
  SELECT id, name INTO v_branch_id, v_branch_name
  FROM branches
  WHERE tenant_id = p_tenant_id AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No active branch found for tenant % — cannot bootstrap accounting', p_tenant_id;
  END IF;

  INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status)
  VALUES (p_tenant_id, v_branch_id, 'branch', v_branch_name, 'active')
  RETURNING id INTO v_owner_id;

  INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason)
  VALUES (p_tenant_id, v_branch_id, v_owner_id, CURRENT_DATE, 'Accounting Bootstrap backfill (Phase 3, 2026-08-11)');

  -- M180's trg_accounting_owners_create_default_book already created the
  -- default Primary book for v_owner_id — fetch it, never insert a second.
  SELECT id INTO v_book_id
  FROM accounting_books
  WHERE tenant_id = p_tenant_id AND accounting_owner_id = v_owner_id AND is_default = true;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'Default accounting book was not created for tenant %', p_tenant_id;
  END IF;

  INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from)
  VALUES (p_tenant_id, 1, 1, make_date(v_year, 1, 1))
  RETURNING id INTO v_calendar_id;

  -- Generates the fiscal_year row + its 12 fiscal_periods rows — sole
  -- sanctioned mechanism, from M179, unmodified.
  PERFORM fn_generate_fiscal_year(p_tenant_id, v_calendar_id, v_year, v_year_label);

  INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance, is_posting_account, is_system_account, is_active)
  VALUES
    (p_tenant_id, '1000', 'Cash',                  'asset',     'debit',  true, true, true),
    (p_tenant_id, '1010', 'Bank',                  'asset',     'debit',  true, true, true),
    (p_tenant_id, '1100', 'Accounts Receivable',   'asset',     'debit',  true, true, true),
    (p_tenant_id, '1200', 'Inventory Asset',       'asset',     'debit',  true, true, true),
    (p_tenant_id, '2100', 'Accounts Payable',      'liability', 'credit', true, true, true),
    (p_tenant_id, '2200', 'Tax Payable',            'liability', 'credit', true, true, true),
    (p_tenant_id, '4000', 'Sales Revenue',          'revenue',   'credit', true, true, true),
    (p_tenant_id, '5000', 'Cost of Goods Sold',     'expense',   'debit',  true, true, true);

  INSERT INTO account_role_assignments (tenant_id, role_code, account_id)
  SELECT p_tenant_id, v.role_code, a.id
  FROM (VALUES
    ('default_cash',        '1000'),
    ('default_bank',        '1010'),
    ('accounts_receivable', '1100'),
    ('inventory_asset',     '1200'),
    ('accounts_payable',    '2100'),
    ('tax_payable',         '2200'),
    ('sales_revenue',       '4000'),
    ('cogs',                '5000')
  ) AS v(role_code, code)
  JOIN accounts a ON a.tenant_id = p_tenant_id AND a.code = v.code;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- No seed data, no invocation here — this migration only creates the
-- function. It is called once per allowlisted tenant by a separate,
-- explicitly-reviewed script (scripts/backfill-accounting-bootstrap.js),
-- never automatically, never for "all tenants" implicitly.

-- Rollback (documented, not auto-executed):
-- DROP FUNCTION IF EXISTS fn_backfill_accounting_bootstrap(UUID);
