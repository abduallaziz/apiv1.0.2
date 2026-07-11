-- S3 — reconciliation migration, follow-up to 086/087.
--
-- Root cause of the RoleCard (3 users) vs RoleUsersSheet (0 users) mismatch
-- reported live: before today's changeRole() fix, role changes updated only
-- users.role (TEXT) and never touched users.role_id or user_roles. 086/087
-- backfilled user_roles FROM users.role_id — which inherited that same
-- staleness for any user whose role was changed via the old changeRole()
-- before the fix. users.role was always kept correct by every changeRole
-- call, old and new, so it — not the possibly-stale role_id — is the
-- reliable source to reconcile from here.
--
-- Step 1: re-resolve role_id from the (always-correct) role text column.
UPDATE users u
SET role_id = r.id
FROM roles r
WHERE r.tenant_id IS NULL
  AND r.name = u.role
  AND u.role_id IS DISTINCT FROM r.id;

-- Step 2: demote any user_roles row still flagged is_primary that no longer
-- matches the freshly-resolved role_id (the stale assignment from before).
UPDATE user_roles ur
SET is_primary = false
FROM users u
WHERE ur.user_id = u.id
  AND ur.is_primary = true
  AND ur.role_id IS DISTINCT FROM u.role_id;

-- Step 3: ensure the correct role has a primary row — insert if missing,
-- or flip is_primary back on if the row already existed as a
-- previously-added secondary role.
INSERT INTO user_roles (user_id, role_id, is_primary)
SELECT u.id, u.role_id, true
FROM users u
WHERE u.role_id IS NOT NULL
ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true;
