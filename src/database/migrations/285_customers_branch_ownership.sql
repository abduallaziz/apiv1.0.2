-- 285_customers_branch_ownership.sql  (Branch isolation TASK 2 - docs/DESIGN_BRANCH_ISOLATION.md D4/D10)
-- Additive only. customers, customer_vehicles and customer_field_definitions become branch-owned.
-- Flag-off behaviour is unchanged: reads/writes ignore branch_id unless tenants.branch_isolation_enabled.
--   * customers.branch_id            : backfilled from created_branch_id; the rest (NULL) go to the MAIN branch
--                                      when isolation is enabled (fn_branch_isolation_backfill, registry below).
--   * customer_vehicles.branch_id    : inherits the owning customer's branch (trigger + backfill).
--   * customer_field_definitions.branch_id : NULL until isolation is enabled, then main branch (registry).
-- Triggers keep branch_id populated from created_branch_id / the customer even while the flag is off, so
-- enabling isolation later never loses provenance.
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_customers_default_branch ON customers;
--           DROP TRIGGER IF EXISTS trg_customer_vehicles_default_branch ON customer_vehicles;
--           DROP FUNCTION IF EXISTS fn_customers_default_branch(); DROP FUNCTION IF EXISTS fn_customer_vehicles_default_branch();
--           DELETE FROM branch_isolation_tables WHERE table_name IN ('customers','customer_vehicles','customer_field_definitions');
--           ALTER TABLE customers DROP COLUMN IF EXISTS branch_id; ALTER TABLE customer_vehicles DROP COLUMN IF EXISTS branch_id;
--           ALTER TABLE customer_field_definitions DROP COLUMN IF EXISTS branch_id;

ALTER TABLE customers                  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE customer_vehicles          ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE customer_field_definitions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Backfill: customers keep the branch they were created in; vehicles follow their customer.
UPDATE customers SET branch_id = created_branch_id
 WHERE branch_id IS NULL AND created_branch_id IS NOT NULL;

UPDATE customer_vehicles v SET branch_id = c.branch_id
  FROM customers c
 WHERE v.customer_id = c.id AND v.branch_id IS NULL AND c.branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_customers_default_branch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NULL AND NEW.created_branch_id IS NOT NULL THEN
    NEW.branch_id := NEW.created_branch_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customers_default_branch ON customers;
CREATE TRIGGER trg_customers_default_branch
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_customers_default_branch();

CREATE OR REPLACE FUNCTION fn_customer_vehicles_default_branch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id FROM customers WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_vehicles_default_branch ON customer_vehicles;
CREATE TRIGGER trg_customer_vehicles_default_branch
  BEFORE INSERT ON customer_vehicles
  FOR EACH ROW EXECUTE FUNCTION fn_customer_vehicles_default_branch();

CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch
  ON customers (tenant_id, branch_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_vehicles_tenant_branch
  ON customer_vehicles (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_field_definitions_tenant_branch
  ON customer_field_definitions (tenant_id, branch_id) WHERE deleted_at IS NULL;

-- Rows still without a branch go to the main branch when a tenant enables isolation.
INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('customers', 'customer belongs to exactly one branch (created_branch_id first, else main)'),
  ('customer_vehicles', 'follows its customer'),
  ('customer_field_definitions', 'per-branch customer form schema')
ON CONFLICT (table_name) DO NOTHING;
