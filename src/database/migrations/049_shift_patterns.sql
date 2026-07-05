-- Replaces the fixed-date-range Schedules workflow with reusable shift
-- patterns: a pattern is created once (days of week + hours) and can be
-- assigned to any number of employees; editing the pattern updates every
-- employee assigned to it. An employee can also have a one-off custom
-- schedule instead of a shared pattern. Neither requires an end date — the
-- employee simply has a start date and works the pattern indefinitely.
--
-- work_schedules (materialized per-date rows) is kept completely unchanged
-- so payroll/attendance reporting (reports.service.ts getPayrollReport) does
-- not need to change at all: assigning a pattern/custom schedule still
-- generates work_schedules rows the same way schedules.bulkCreate already
-- did, just automatically for a rolling window instead of the user having
-- to pick a date_to.

CREATE TABLE shift_patterns (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  days_of_week    INTEGER[]   NOT NULL DEFAULT '{}',
  start_time      TIME        NOT NULL,
  end_time        TIME        NOT NULL,
  day_overrides   JSONB       NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_shift_patterns_tenant ON shift_patterns(tenant_id);

-- Per-employee schedule assignment: either shift_pattern_id (shared pattern)
-- or the custom_* columns (one-off schedule), never both populated at once.
-- schedule_start_date is when the pattern starts applying; no end date by
-- design (per explicit product decision — indefinite employment).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shift_pattern_id UUID REFERENCES shift_patterns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_days_of_week INTEGER[],
  ADD COLUMN IF NOT EXISTS custom_start_time TIME,
  ADD COLUMN IF NOT EXISTS custom_end_time TIME,
  ADD COLUMN IF NOT EXISTS custom_day_overrides JSONB,
  ADD COLUMN IF NOT EXISTS schedule_start_date DATE;

GRANT ALL ON public.shift_patterns TO service_role;
