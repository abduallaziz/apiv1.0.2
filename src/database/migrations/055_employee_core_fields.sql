-- Additive HR "Employee Core" fields, all nullable/backward compatible — no
-- existing row is affected, no FK/table restructuring. Kept on the `users` row
-- (see 044/046/047/049/051/052/053 for the same additive pattern) rather than a
-- separate table, since splitting the entity would require migrating every
-- module that references user_id (attendance, leaves, payroll, shift patterns,
-- geofences, audit logs) — out of scope for an additive change.
--
-- attendance_enabled is a distinct on/off flag from attendance_token: the
-- Employee Profile "Attendance" tab needs to show Enabled/Disabled independent
-- of whether a link has actually been generated yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_number TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS identity_number TEXT,
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time')),
  ADD COLUMN IF NOT EXISTS join_date DATE,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS gps_radius_meters INTEGER CHECK (gps_radius_meters IS NULL OR gps_radius_meters > 0),
  ADD COLUMN IF NOT EXISTS attendance_enabled BOOLEAN NOT NULL DEFAULT false;

-- employee_number is human-facing (e.g. "EMP-001") and should be unique per
-- tenant when set, but not globally unique (two tenants may both use EMP-001).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_employee_number
  ON users(tenant_id, employee_number) WHERE employee_number IS NOT NULL;
