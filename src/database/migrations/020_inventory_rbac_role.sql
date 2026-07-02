-- =============================================================================
-- 020. RBAC — add 'inventory_clerk' role for warehouse/inventory operations.
-- (Read-only inventory access is covered by the existing 'worker' role via
-- the new inventory.view permission — no separate "viewer" role is added to
-- avoid two roles with identical semantics across the platform.)
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','owner','manager','cashier','worker','inventory_clerk'));

ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
  CHECK (role IN ('superadmin','owner','manager','cashier','worker','inventory_clerk'));
