-- Customer Domain Phase 5 (Owner-approved) — one Loyalty Ledger serving
-- both Loyalty Scope modes (SHARED and BRANCH), per the approved
-- architecture. Purely additive: no existing table/column is touched,
-- customers.loyalty_points/lifetime_points_earned remain exactly as they
-- are today, and no historical event rows are invented — there is no
-- reliable source to reconstruct past loyalty activity from, so this
-- table starts empty and only ever grows from this point forward.
--
-- branch_id/order_id are both nullable by design:
--   - branch_id is NULL only for a manual/administrative adjustment made
--     with no branch context (e.g. a Central support action).
--   - order_id is NULL for manual adjustments AND for a real redemption
--     event, because redemption is deliberately executed before the
--     order row exists (see invoices.service.ts's own documented
--     ordering — redeeming after order creation previously allowed a
--     failed atomic redemption to leave an already-created invoice with
--     an applied-but-unpaid-for discount).
CREATE TABLE loyalty_ledger (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  customer_id UUID        NOT NULL REFERENCES customers(id),
  branch_id   UUID        REFERENCES branches(id),
  order_id    UUID        REFERENCES orders(id),
  type        TEXT        NOT NULL CHECK (type IN ('earn', 'redeem', 'adjustment')),
  delta       NUMERIC     NOT NULL,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_ledger_customer
  ON loyalty_ledger (tenant_id, customer_id, created_at);
CREATE INDEX idx_loyalty_ledger_branch
  ON loyalty_ledger (tenant_id, branch_id, created_at);

ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON loyalty_ledger
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.loyalty_ledger TO service_role;
