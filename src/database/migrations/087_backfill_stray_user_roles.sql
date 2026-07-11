-- S3 — Multi-role migration, safety-net backfill (follow-up to 086).
-- Re-runs the same users.role_id -> user_roles backfill 086 already did, as
-- an idempotent catch-all for any user who acquired a role_id afterward
-- (086's INSERT only ran once, at that moment in time) without a matching
-- user_roles row — e.g. any account created between 086 and the register()
-- fix that started inserting user_roles directly.
-- ON CONFLICT DO NOTHING makes this safe to run any number of times: users
-- already covered by 086 or by the register() write path are silently
-- skipped, never duplicated (UNIQUE (user_id, role_id) from 086 backs this).
INSERT INTO user_roles (user_id, role_id, is_primary)
SELECT u.id, u.role_id, true
FROM users u
WHERE u.role_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = u.role_id
  )
ON CONFLICT (user_id, role_id) DO NOTHING;
