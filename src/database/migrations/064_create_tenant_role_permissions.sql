-- S5 Stage A of the Access Control Architecture. Creates the tenant
-- customization layer on top of the existing global role_permissions table.
--
-- Inheritance model (see S5 architecture review):
--   role_permissions        -> permanent global default, unchanged, always the floor
--   tenant_role_permissions -> optional per-tenant override, checked first when present
-- A tenant with zero rows here behaves 100% identically to today.
--
-- This migration is schema-only. It does NOT change PermissionsService,
-- PermissionGuard, or any of the 212 @RequirePermission() routes. The table
-- starts empty and nothing reads from it yet, so this cannot change any
-- existing authorization decision. That wiring is Stage B, a separate change.
--
-- permission_key (not permission_id) is used deliberately, matching the
-- existing role_permissions.permission_key convention exactly — PermissionsService
-- already works entirely in terms of permission-key strings (its Redis-cached
-- set is a Set<string> of keys), so Stage B needs no id<->key translation layer.
CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id        UUID        NOT NULL REFERENCES roles(id),
  permission_key TEXT        NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,
  is_granted     BOOLEAN     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, role_id, permission_key)
);

-- Lookup index for "does this tenant have any overrides for this role" —
-- redundant with the UNIQUE constraint for the 3-column case, but this also
-- serves the common admin-UI query "list all overrides for a tenant" (2-column
-- prefix scan) once that UI is built in a later stage.
CREATE INDEX IF NOT EXISTS idx_tenant_role_permissions_tenant_role
  ON tenant_role_permissions (tenant_id, role_id);
