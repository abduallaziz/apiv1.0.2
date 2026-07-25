-- Purchasing redesign — item #9.2: Purchase Request (PR), fully independent
-- of purchase_orders (zero FK between them — a PR may later be converted
-- to an RFQ or PO, or a PO may be created from scratch, entirely outside
-- application logic, not a DB constraint). Also introduces
-- `approval_history` as the ONE generic, reusable audit trail for every
-- approval-driven entity in Sefay (PR today; RFQ/PO/Expenses/Sales/
-- Inventory/Returns later) — reference_type/reference_id polymorphic,
-- same pattern already used by `shipments` (migration 116).
--
-- PR deliberately carries NO pricing (no estimated_unit_cost on its
-- lines) — a PR expresses WHAT is needed, not what it costs. Pricing
-- starts at RFQ, is negotiated into a PO, and becomes real cost at Goods
-- Receipt (unchanged, untouched by this migration). PR never touches
-- inventory/cost_layers/goods_receipt — confirmed zero references to any
-- of those from this migration or the module it backs.

CREATE TABLE purchase_requests (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      UUID        REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id   UUID        REFERENCES warehouses(id) ON DELETE SET NULL,
  request_number TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  requested_by   UUID        REFERENCES users(id),
  approved_by    UUID        REFERENCES users(id),
  approved_at    TIMESTAMPTZ,
  notes          TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_pr_tenant_number ON purchase_requests(tenant_id, request_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_pr_tenant_status ON purchase_requests(tenant_id, status) WHERE deleted_at IS NULL;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON purchase_requests
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.purchase_requests TO service_role;

CREATE TABLE purchase_request_items (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_request_id UUID          NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  item_id             UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id          UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_requested  NUMERIC(14,4) NOT NULL CHECK (quantity_requested > 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pr_items_pr ON purchase_request_items(purchase_request_id);
ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON purchase_request_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.purchase_request_items TO service_role;

-- Append-only audit ledger (no update/delete, no deleted_at — nothing
-- should ever remove an approval-history row, same immutability
-- principle as stock_movements). Genuinely generic: any future
-- approval-driven entity records here with its own reference_type,
-- with zero schema change.
CREATE TABLE approval_history (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_type   TEXT        NOT NULL,
  reference_id     UUID        NOT NULL,
  action           TEXT        NOT NULL,
  actor_id         UUID        REFERENCES users(id),
  previous_status  TEXT,
  new_status       TEXT,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_approval_history_reference ON approval_history(tenant_id, reference_type, reference_id, created_at);
ALTER TABLE approval_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON approval_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.approval_history TO service_role;
