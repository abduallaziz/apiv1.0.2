-- 286_customers_per_branch_unique.sql  (Branch isolation TASK 2 - D5)
-- Creates the branch-scoped unique indexes FIRST. Legacy NULL-branch rows collapse to the nil uuid, so
-- they keep today's tenant-wide uniqueness. The old tenant-wide indexes are dropped in 287.
-- ROLLBACK: DROP INDEX IF EXISTS uq_customers_branch_phone_normalized, uq_customer_vehicles_branch_plate,
--           uq_customer_field_definitions_branch_field_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_branch_phone_normalized
  ON customers (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_vehicles_branch_plate
  ON customer_vehicles (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), plate_normalized)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_field_definitions_branch_field_key
  ON customer_field_definitions (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), field_key)
  WHERE deleted_at IS NULL;
