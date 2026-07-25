-- Purchasing redesign — item #9.3.2: Supplier Quotes, one independent
-- quote per supplier within an RFQ, with revisions managed via a stable
-- quote_groups identity (NOT a supersedes_quote_id chain) — "latest
-- version" and "all versions" are both direct queries on quote_group_id,
-- no chain traversal ever needed.
--
-- ALL pricing/discount/currency/tax/lead-time/MOQ data lives here and in
-- supplier_quote_items — rfqs/rfq_items carry none of it.

CREATE TABLE quote_groups (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rfq_id      UUID        NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, supplier_id)
);
ALTER TABLE quote_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quote_groups
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quote_groups TO service_role;

CREATE TABLE supplier_quotes (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_group_id  UUID        NOT NULL REFERENCES quote_groups(id) ON DELETE CASCADE,
  version         INTEGER     NOT NULL DEFAULT 1 CHECK (version > 0),
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected', 'expired', 'superseded')),
  currency        TEXT        NOT NULL DEFAULT 'SAR',
  expiration_date DATE,
  notes           TEXT,
  submitted_at    TIMESTAMPTZ,
  created_by      UUID        REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quote_group_id, version)
);
CREATE INDEX idx_supplier_quotes_group ON supplier_quotes(quote_group_id);
-- Only one non-superseded/non-terminal quote per group at a time — a new
-- revision must first move the previous one to 'superseded'.
CREATE UNIQUE INDEX uq_supplier_quotes_active_per_group ON supplier_quotes(quote_group_id)
  WHERE status IN ('draft', 'submitted', 'accepted') AND deleted_at IS NULL;
ALTER TABLE supplier_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON supplier_quotes
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.supplier_quotes TO service_role;

CREATE TABLE supplier_quote_items (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_quote_id UUID          NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
  rfq_item_id       UUID          REFERENCES rfq_items(id) ON DELETE SET NULL,
  item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id        UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_offered  NUMERIC(14,4) NOT NULL CHECK (quantity_offered > 0),
  unit_price        NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
  discount_percent  NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  currency          TEXT,
  lead_time_days    NUMERIC(6,2),
  moq               NUMERIC(14,4),
  tax_rate          NUMERIC(5,2),
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_supplier_quote_items_quote ON supplier_quote_items(supplier_quote_id);
ALTER TABLE supplier_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON supplier_quote_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.supplier_quote_items TO service_role;
