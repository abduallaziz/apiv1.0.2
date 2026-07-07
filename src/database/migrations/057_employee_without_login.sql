-- Employee Core records must be creatable without a System User login account
-- (see architecture separation: employee creation must NOT auto-create email/
-- password/systemRole). Both columns already have real values on every existing
-- row, so relaxing NOT NULL only affects future inserts — no data is touched.
-- email keeps its UNIQUE constraint; Postgres allows multiple NULLs in a unique
-- index, so several login-less employees can coexist without an email.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 'none' = Employee Core record with no dashboard/login access at all (no
-- role_permissions rows are seeded for it, so it resolves to zero permissions
-- automatically — nothing else needs to change for this to be safe).
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','owner','manager','cashier','worker','inventory_clerk','none'));
