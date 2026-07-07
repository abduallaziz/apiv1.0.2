-- Explicit indicator that a users row has an Employee Core profile, separate
-- from whether it has System User login credentials. This is the "storage
-- compatibility layer" decision: one users table stays the source of truth
-- (no two-table split — every existing FK to users.id, e.g. attendance_records,
-- leave_requests, employee_geofences, audit_logs, keeps working untouched),
-- but System Users and Employee Profiles are now logically independent:
--   - A System User (has email/password/role) does NOT automatically have
--     is_employee_profile = true, so it does not appear on the Employees page.
--   - An Employee Profile (is_employee_profile = true) does NOT require
--     email/password — see 057_employee_without_login.sql.
--   - "Link existing System User" (new /employees/:id/link action) just flips
--     this flag true on that same row.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_employee_profile BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any row already created via the Employee Core wizard (role='none')
-- or that already has HR/payroll data filled in (department, job_title,
-- employee_number, base_salary) is, by definition, already being used as an
-- employee profile today — flip the flag so the new Employees page keeps
-- showing exactly what it showed before this migration (no visibility regression).
UPDATE users
SET is_employee_profile = true
WHERE role = 'none'
   OR department IS NOT NULL
   OR job_title IS NOT NULL
   OR employee_number IS NOT NULL
   OR base_salary IS NOT NULL;
