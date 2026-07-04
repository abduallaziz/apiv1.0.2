-- Phase 10I — Attendance geofencing, per-employee payroll deduction policy, absence exceptions.

-- Branch-level default geofence (center + radius in meters). NULL = no geofence enforced.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS geofence_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS geofence_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS geofence_radius_m NUMERIC CHECK (geofence_radius_m IS NULL OR geofence_radius_m > 0);

-- Per-employee override zones (field workers). Multiple rows can be active for the same
-- employee at once (visits several sites) — any one of them being within range is sufficient.
-- valid_from/valid_to bound a zone to specific dates; NULL on either side means unbounded
-- on that side, and both NULL means "always valid" (a standing site for this employee).
CREATE TABLE employee_geofences (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT,
  center_lat        NUMERIC     NOT NULL,
  center_lng        NUMERIC     NOT NULL,
  radius_m          NUMERIC     NOT NULL CHECK (radius_m > 0),
  valid_from        DATE,
  valid_to          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_employee_geofences_user ON employee_geofences(tenant_id, user_id);

-- Where the employee actually was when they punched in/out — kept for audit even though
-- validation already happened server-side at the time of the request.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS check_in_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS check_in_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS check_out_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS check_out_lng NUMERIC;

-- Per-employee payroll + lateness policy. All nullable — a NULL base_salary means this
-- employee isn't on payroll tracking at all, zero behavior change for existing users.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS base_salary NUMERIC CHECK (base_salary IS NULL OR base_salary >= 0),
  ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_period_minutes >= 0),
  ADD COLUMN IF NOT EXISTS late_deduction_mode TEXT CHECK (late_deduction_mode IS NULL OR late_deduction_mode IN ('fixed', 'per_minute', 'percentage_of_daily_rate')),
  ADD COLUMN IF NOT EXISTS late_deduction_value NUMERIC CHECK (late_deduction_value IS NULL OR late_deduction_value >= 0);

-- A scheduled work day (see work_schedules) with no matching attendance record is an
-- absence by default. A manager can excuse a specific date for a specific employee here,
-- which waives that day's deduction in the payroll report.
CREATE TABLE attendance_exceptions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  reason      TEXT        NOT NULL,
  created_by  UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, date)
);
CREATE INDEX idx_attendance_exceptions_user ON attendance_exceptions(tenant_id, user_id, date);
