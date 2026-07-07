-- Foundation stage of the Sefay Access Control Architecture (S1).
-- Introduces a real `roles` table alongside the existing users.role TEXT/CHECK
-- column. This is additive only: nothing reads from this table yet, so it
-- cannot change any existing authorization behavior.
--
-- Architecture rule (do not violate in later migrations):
--   tenant_id IS NULL  -> system role, shared by every tenant, is_system = true
--   tenant_id NOT NULL -> tenant-owned custom role (e.g. "Expense Manager")
-- System roles are never copied per-tenant. Tenant-specific customization of
-- what a system role can do belongs in a future tenant_role_permissions table,
-- not in duplicate rows here.
CREATE TABLE IF NOT EXISTS roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plain UNIQUE(tenant_id, name) would NOT catch duplicate system role names,
-- because Postgres treats NULL != NULL for uniqueness purposes. Two partial
-- unique indexes cover both cases correctly:
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_system_name_unique
  ON roles (name) WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_name_unique
  ON roles (tenant_id, name) WHERE tenant_id IS NOT NULL;

-- Seed the 7 existing system roles — matches the current users_role_check
-- constraint exactly, including 'inventory_clerk' (added in migration 020)
-- and 'none' (added in migration 057). tenant_id = NULL, is_system = true,
-- no per-tenant copies.
INSERT INTO roles (name, description, is_system, tenant_id)
VALUES
  ('superadmin',      'Platform-level administrator across all tenants', true, NULL),
  ('owner',           'Business owner — full access within their tenant', true, NULL),
  ('manager',         'Branch/operations manager', true, NULL),
  ('cashier',         'Point-of-sale operator', true, NULL),
  ('worker',          'General staff member', true, NULL),
  ('inventory_clerk', 'Warehouse/inventory operations staff', true, NULL),
  ('none',            'Employee profile with no system login/dashboard access', true, NULL)
ON CONFLICT DO NOTHING;
