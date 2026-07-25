-- Purchasing redesign — item #9.3.3: Award — a fully independent document,
-- not a link table. Has its own number/date/status/approval columns
-- exactly like every other approvable document in this project (PR, PO),
-- so wiring ApprovalEngine to it later is pure service logic, zero schema
-- change. Multiple awards may exist per RFQ over time (re-awarding =
-- a brand-new award document, never editing an old one) — "the current
-- award" is simply the latest 'confirmed' row for that rfq_id; the full
-- decision history is just the set of rows themselves, no chain needed.
--
-- award_items snapshots the winning quote line's pricing at the moment of
-- award (awarded_unit_price/discount/currency/lead_time/tax_rate) — so a
-- later edit to the supplier's quote can never retroactively change what
-- was actually awarded. source_supplier_quote_item_id is kept purely for
-- traceability back to where the snapshot came from.

CREATE TABLE awards (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rfq_id       UUID        NOT NULL REFERENCES rfqs(id) ON DELETE RESTRICT,
  award_number TEXT        NOT NULL,
  award_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  notes        TEXT,
  created_by   UUID        REFERENCES users(id),
  approved_by  UUID        REFERENCES users(id),
  approved_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_award_tenant_number ON awards(tenant_id, award_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_awards_rfq ON awards(rfq_id, status);
ALTER TABLE awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON awards
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.awards TO service_role;

CREATE TABLE award_items (
  id                            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  award_id                      UUID          NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  rfq_item_id                   UUID          REFERENCES rfq_items(id) ON DELETE SET NULL,
  source_supplier_quote_item_id UUID          REFERENCES supplier_quote_items(id) ON DELETE SET NULL,
  awarded_quantity              NUMERIC(14,4) NOT NULL CHECK (awarded_quantity > 0),
  awarded_unit_price            NUMERIC(14,4) NOT NULL CHECK (awarded_unit_price >= 0),
  awarded_discount              NUMERIC(5,2)  NOT NULL DEFAULT 0,
  awarded_currency              TEXT          NOT NULL,
  awarded_lead_time             NUMERIC(6,2),
  awarded_tax_rate              NUMERIC(5,2),
  notes                         TEXT,
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_award_items_award ON award_items(award_id);
ALTER TABLE award_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON award_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.award_items TO service_role;
