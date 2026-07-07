-- Foundation stage (S4). Adds a real manager-hierarchy FK so a future
-- "manager sees only direct reports" access scope can be enforced reliably.
--
-- Numbering note: 062 is intentionally reserved for the future, separately
-- reviewed department-backfill migration (see 061_create_departments_table.sql)
-- so it can land between this file and its neighbors without renumbering.
--
-- IMPORTANT: this does NOT read or convert the existing free-text
-- users.manager_name column. manager_name may not uniquely (or correctly)
-- match a users.id — e.g. duplicate names, inactive managers, typos — so no
-- automatic matching is performed. manager_id starts NULL for every row and
-- is populated later via UI or a manually reviewed one-time script.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users (manager_id);
