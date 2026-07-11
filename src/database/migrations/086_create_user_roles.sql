-- S3 — Multi-role assignment foundation (Phase 1 of the User Management plan).
-- Introduces `user_roles`, a many-to-many junction between users and roles,
-- alongside the existing `users.role` TEXT/CHECK column and the dormant
-- `users.role_id` FK (added in migration 060). This is additive only:
-- nothing reads from this table yet, so it cannot change any existing
-- authorization behavior. Same pattern as 059/060.
--
-- Architecture rule (do not violate in later phases):
--   is_primary = true marks the single role shown wherever the system still
--   expects exactly one role (audit logs, legacy UI, users.role/-role_id
--   compatibility) until Phase 2/3 migrate those call sites onto the full
--   role set.
CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_primary  BOOLEAN     NOT NULL DEFAULT false,
  granted_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);

-- Backfill from users.role_id (populated by migration 060's own backfill,
-- which matched users.role by name among system roles) — not from
-- users.role by name again, so this can never disagree with what 060
-- already resolved.
INSERT INTO user_roles (user_id, role_id, is_primary)
SELECT u.id, u.role_id, true
FROM users u
WHERE u.role_id IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;
