-- Dedicated TEST tenant for the local test database (id matches the QA tenant id the specs hard-code).
INSERT INTO tenants (id, name, business_type, activity, status)
VALUES ('9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Local Test Tenant', 'retail', 'supermarket', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, tenant_id, name)
VALUES ('9bcd3369-0000-4000-8000-000000000001', '9bcd3369-d664-47c8-b297-3bc9b429aacf', 'Main')
ON CONFLICT (id) DO NOTHING;

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
