-- 251. Register close with per-method counts + immutable report snapshot
-- (Phase 2 of DESIGN-REVIEW-REGISTER-CLOSE-2026-11-09, owner approved with
-- the exact message "Approved - Proceed with Implementation").
--
-- Decisions (owner, 2026-11-09): the register IS the shift; at close the
-- cashier enters the counted amount per payment method (cash, mada, visa,
-- mastercard), the system stores counted vs expected per method and an
-- immutable snapshot of the close report (the daily report that is printed
-- or shared as PDF). A closed register is final: no re-open, no adjustment
-- lines. Per the new-table checklist: tenant_id, deleted_at, RLS policy and
-- an explicit service_role GRANT from the start.

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by       UUID REFERENCES users(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS close_notes     TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS report_snapshot JSONB;

CREATE TABLE IF NOT EXISTS shift_counts (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id       UUID          NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  payment_method TEXT          NOT NULL CHECK (payment_method IN ('cash', 'mada', 'visa', 'mastercard')),
  counted        NUMERIC(12,2) NOT NULL CHECK (counted >= 0),
  expected       NUMERIC(12,2) NOT NULL,
  difference     NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (shift_id, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_shift_counts_shift ON shift_counts (tenant_id, shift_id);

ALTER TABLE shift_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON shift_counts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.shift_counts TO service_role;
