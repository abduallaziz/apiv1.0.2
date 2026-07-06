-- Minimal leave-tracking and notifications, needed for the employee
-- dashboard shown on the personal attendance-link page: leave balance,
-- recent leaves, recent notifications.

CREATE TABLE leave_requests (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type    TEXT        NOT NULL DEFAULT 'annual',
  date_from     DATE        NOT NULL,
  date_to       DATE        NOT NULL,
  days_count    INTEGER     NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_to >= date_from)
);
CREATE INDEX idx_leave_requests_tenant_user ON leave_requests(tenant_id, user_id, date_from);

CREATE TABLE notifications (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID        REFERENCES users(id) ON DELETE CASCADE, -- NULL = broadcast to whole tenant
  title         TEXT        NOT NULL,
  body          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ
);
CREATE INDEX idx_notifications_tenant_user ON notifications(tenant_id, user_id, created_at);

-- Annual leave allowance in days. Nullable — NULL means not tracked for this
-- employee (existing users unaffected); remaining balance is computed as
-- this minus approved leave_requests.days_count within the current year.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS annual_leave_balance INTEGER;

GRANT ALL ON public.leave_requests TO service_role;
GRANT ALL ON public.notifications TO service_role;
