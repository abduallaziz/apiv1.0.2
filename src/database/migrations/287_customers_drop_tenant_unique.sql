-- 287_customers_drop_tenant_unique.sql  (Branch isolation TASK 2 - D5)
-- The branch-scoped indexes of 286 exist (they are strictly weaker, so they cannot conflict with data that
-- satisfied the old ones). The old tenant-wide indexes would forbid the same phone/plate in two branches.
-- While a tenant runs with isolation OFF the application keeps rejecting a phone/plate already used anywhere
-- in the tenant (lookups stay tenant-wide), so flag-off behaviour is unchanged apart from the DB-level race net.
-- ROLLBACK (only valid while no phone/plate is duplicated across branches):
--   CREATE UNIQUE INDEX uq_customers_tenant_phone_normalized ON customers (tenant_id, phone_normalized)
--     WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;
--   CREATE UNIQUE INDEX uq_customer_vehicles_tenant_plate ON customer_vehicles (tenant_id, plate_normalized) WHERE deleted_at IS NULL;
--   CREATE UNIQUE INDEX uq_customer_field_definitions_tenant_field_key ON customer_field_definitions(tenant_id, field_key) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS uq_customers_tenant_phone_normalized;
DROP INDEX IF EXISTS uq_customer_vehicles_tenant_plate;
DROP INDEX IF EXISTS uq_customer_field_definitions_tenant_field_key;
