-- Dedicated TEST tenant for the local test database (id matches the QA tenant id the specs hard-code).
INSERT INTO tenants (id, name, business_type, activity, status)
VALUES ('9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Local Test Tenant', 'retail', 'supermarket', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, tenant_id, name)
VALUES ('9bcd3369-0000-4000-8000-000000000001', '9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Main Branch')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
VALUES ('9bcd3369-0000-4000-8000-000000000002', '9bcd3369-d664-47c8-b297-3bc9b429aacf',
        '9bcd3369-0000-4000-8000-000000000001', 'WH-TEST', 'Test Warehouse')
ON CONFLICT (id) DO NOTHING;

-- Second tenant (several specs assert cross-tenant isolation against "any other tenant").
INSERT INTO tenants (id, name, business_type, status)
VALUES ('9bcd3369-1111-4000-8000-000000000000', 'Local Other Tenant', 'retail', 'active')
ON CONFLICT (id) DO NOTHING;

-- Users of the test tenant (specs pick "a user" for actor ids).
INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, is_active)
VALUES
  ('9bcd3369-0000-4000-8000-000000000010', '9bcd3369-d664-47c8-b297-3bc9b429aacf', NULL, 'Test Owner',   'owner@local-test.invalid',   'x', 'owner',   true),
  ('9bcd3369-0000-4000-8000-000000000011', '9bcd3369-d664-47c8-b297-3bc9b429aacf', NULL, 'Test Cashier', 'cashier@local-test.invalid', 'x', 'cashier', true)
ON CONFLICT (id) DO NOTHING;

-- Catalogue fixtures the production demo tenant has: purchasing specs (agreements, amendments,
-- releases, rfq-award, ...) and the accounting spec pick "any supplier / any item" of the test tenant.
INSERT INTO suppliers (id, tenant_id, name, is_active)
VALUES ('9bcd3369-0000-4000-8000-000000000020', '9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Local Test Supplier', true)
ON CONFLICT (id) DO NOTHING;

-- accounting-posting-engine needs one stock-tracked item (has_inventory=true) and one service item (false).
INSERT INTO items (id, tenant_id, name, type, operation_type, price, has_inventory, is_active)
VALUES
  ('9bcd3369-0000-4000-8000-000000000030', '9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Local Test Tracked Item', 'product', 'sell', 10, true,  true),
  ('9bcd3369-0000-4000-8000-000000000031', '9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Local Test Service Item', 'service', 'sell', 10, false, true)
ON CONFLICT (id) DO NOTHING;

-- Accounting provisioning of the production demo tenant (accounting-posting-engine reads it read-only):
-- accounting owner + branch assignment, fiscal calendar with the current and next fiscal year,
-- posting accounts and the account-role assignments. (The default accounting book is created by trigger.)
INSERT INTO accounting_owners (id, tenant_id, branch_id, owner_type_code, name, status)
VALUES ('9bcd3369-0000-4000-8000-000000000040', '9bcd3369-d664-47c8-b297-3bc9b429aacf',
        '9bcd3369-0000-4000-8000-000000000001', 'branch', 'Main', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason)
SELECT '9bcd3369-d664-47c8-b297-3bc9b429aacf', '9bcd3369-0000-4000-8000-000000000001',
       '9bcd3369-0000-4000-8000-000000000040', '2020-01-01', 'local test seed'
WHERE NOT EXISTS (SELECT 1 FROM branch_accounting_assignments
                  WHERE accounting_owner_id = '9bcd3369-0000-4000-8000-000000000040');

INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance, is_posting_account, is_system_account, is_active)
SELECT '9bcd3369-d664-47c8-b297-3bc9b429aacf', v.code, v.name, v.account_type, v.normal_balance, true, true, true
FROM (VALUES ('1000','Cash','asset','debit'),('1010','Bank','asset','debit'),
             ('1100','Accounts Receivable','asset','debit'),('1200','Inventory Asset','asset','debit'),
             ('2100','Accounts Payable','liability','credit'),('2200','Tax Payable','liability','credit'),
             ('4000','Sales Revenue','revenue','credit'),('5000','Cost of Goods Sold','expense','debit')
     ) AS v(code, name, account_type, normal_balance)
WHERE NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.tenant_id = '9bcd3369-d664-47c8-b297-3bc9b429aacf' AND a.code = v.code);

INSERT INTO account_role_assignments (tenant_id, role_code, account_id)
SELECT '9bcd3369-d664-47c8-b297-3bc9b429aacf', v.role_code, a.id
FROM (VALUES ('default_cash','1000'),('default_bank','1010'),('accounts_receivable','1100'),
             ('inventory_asset','1200'),('accounts_payable','2100'),('tax_payable','2200'),
             ('sales_revenue','4000'),('cogs','5000')) AS v(role_code, code)
JOIN accounts a ON a.tenant_id = '9bcd3369-d664-47c8-b297-3bc9b429aacf' AND a.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM account_role_assignments r
                  WHERE r.tenant_id = '9bcd3369-d664-47c8-b297-3bc9b429aacf' AND r.role_code = v.role_code);

DO $$
DECLARE
  t CONSTANT uuid := '9bcd3369-d664-47c8-b297-3bc9b429aacf';
  cal uuid;
  y int := EXTRACT(year FROM now())::int;
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_calendars WHERE tenant_id = t) THEN RETURN; END IF;
  INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from)
  VALUES (t, 1, 1, make_date(y, 1, 1)) RETURNING id INTO cal;
  PERFORM fn_generate_fiscal_year(t, cal, y, y::text);
  PERFORM fn_generate_fiscal_year(t, cal, y + 1, (y + 1)::text);
END $$;
