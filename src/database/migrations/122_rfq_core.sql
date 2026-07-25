-- Purchasing redesign — item #9.3.1: RFQ core (the container itself).
-- Deliberately carries NO pricing/currency/discount fields — those live
-- exclusively in supplier_quotes/supplier_quote_items (migration 123).
-- Status has NO 'awarded' state — award is an entirely independent
-- document/lifecycle (migration 124); "does this RFQ have an award?" is
-- a query (EXISTS on awards.rfq_id), never a status value here.

CREATE TABLE rfqs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      UUID        REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id   UUID        REFERENCES warehouses(id) ON DELETE SET NULL,
  source_pr_id   UUID        REFERENCES purchase_requests(id) ON DELETE SET NULL,
  rfq_number     TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'sent', 'cancelled')),
  notes          TEXT,
  created_by     UUID        REFERENCES users(id),
  approved_by    UUID        REFERENCES users(id),
  approved_at    TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_rfq_tenant_number ON rfqs(tenant_id, rfq_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_rfq_tenant_status ON rfqs(tenant_id, status) WHERE deleted_at IS NULL;
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON rfqs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.rfqs TO service_role;

-- What we want quotes on — the RFQ's own requested lines, no pricing.
CREATE TABLE rfq_items (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rfq_id             UUID          NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_requested NUMERIC(14,4) NOT NULL CHECK (quantity_requested > 0),
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rfq_items_rfq ON rfq_items(rfq_id);
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON rfq_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.rfq_items TO service_role;

-- Which suppliers this RFQ was sent to — one RFQ, many suppliers,
-- without creating a separate RFQ per supplier.
CREATE TABLE rfq_suppliers (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rfq_id      UUID        NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, supplier_id)
);
CREATE INDEX idx_rfq_suppliers_rfq ON rfq_suppliers(rfq_id);
ALTER TABLE rfq_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON rfq_suppliers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.rfq_suppliers TO service_role;
