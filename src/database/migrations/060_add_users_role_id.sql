-- Foundation stage (S2). Adds a nullable FK from users to the new roles
-- table and backfills it by matching the existing users.role TEXT value to
-- roles.name among system roles (tenant_id IS NULL).
--
-- IMPORTANT: users.role remains completely unchanged and remains the
-- live authorization source. PermissionGuard and PermissionsService are not
-- touched by this migration and continue reading users.role exactly as
-- before. role_id is dormant until a later stage explicitly wires it in.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

UPDATE users u
SET role_id = r.id
FROM roles r
WHERE r.tenant_id IS NULL
  AND r.name = u.role
  AND u.role_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);
