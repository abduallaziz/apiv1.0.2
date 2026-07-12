-- Phase A of the Hybrid RBAC+ABAC permission model — additive only, no
-- service logic touches this table yet (PermissionsService/PermissionGuard
-- are unchanged in this migration by design, per the approved plan).
--
-- The service_role GRANT is included in THIS SAME migration file
-- deliberately — the exact gap that silently broke production twice this
-- session already (086 created user_roles without granting service_role,
-- fixed two migrations later in 089; the same class of gap was documented
-- back in migration 066 for roles/permission_groups/tenant_role_permissions).
-- Not repeating that mistake a third time.
CREATE TABLE IF NOT EXISTS user_permissions_override (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key  TEXT        NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,
  action          TEXT        NOT NULL CHECK (action IN ('GRANT', 'DENY')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index (not a plain UNIQUE constraint) — WHERE is_active =
-- TRUE means a revoked/disabled override row can stay in the table for
-- audit history without blocking a fresh override being created later for
-- the same (user_id, permission_key). A plain unique constraint would
-- reject that re-grant unless the old row were hard-deleted first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permission
  ON user_permissions_override (user_id, permission_key)
  WHERE is_active = TRUE;

-- Lookup pattern is always "all active overrides for this user" (see the
-- Phase B integration plan) — this index is what actually serves that
-- query in O(log n); the partial unique index above enforces the
-- constraint but a plain user_id-only index better matches the real access
-- pattern (fetching every override for a user, not a single
-- user_id+permission_key pair at a time).
CREATE INDEX IF NOT EXISTS idx_user_permissions_override_user_id
  ON user_permissions_override (user_id)
  WHERE is_active = TRUE;

GRANT ALL PRIVILEGES ON public.user_permissions_override TO service_role;

-- ============================================================
-- VERIFICATION (run manually after apply)
-- ============================================================
-- 1. Confirm both indexes exist:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'user_permissions_override';
--
-- 2. Confirm service_role has full CRUD privileges:
-- SELECT privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'user_permissions_override' AND grantee = 'service_role'
-- ORDER BY privilege_type;
