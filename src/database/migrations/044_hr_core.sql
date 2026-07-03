-- Phase 10H — HR: attendance, scheduling, sales commissions.

CREATE TABLE attendance_records (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id     UUID        REFERENCES branches(id) ON DELETE SET NULL,
  check_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attendance_tenant_user ON attendance_records(tenant_id, user_id, check_in_at);
-- One open (not checked out) attendance record per user at a time.
CREATE UNIQUE INDEX uq_attendance_open_per_user ON attendance_records(tenant_id, user_id) WHERE check_out_at IS NULL;

CREATE TABLE work_schedules (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id       UUID        REFERENCES branches(id) ON DELETE SET NULL,
  scheduled_date  DATE        NOT NULL,
  start_time      TIME        NOT NULL,
  end_time        TIME        NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_schedules_tenant_user_date ON work_schedules(tenant_id, user_id, scheduled_date);
CREATE INDEX idx_schedules_tenant_date ON work_schedules(tenant_id, scheduled_date);

-- Sales commission: stored as a fraction (0-1), same convention as tenants.tax_rate.
-- NULL (default) means no commission — zero behavior change for existing users.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));
