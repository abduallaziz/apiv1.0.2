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
