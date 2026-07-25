-- Purchasing #9.5.2: Agreement pricing via dedicated relational tables,
-- NOT JSONB — every other structured business concept across this
-- entire schema (129 prior migrations) uses normalized, RLS-scoped,
-- FK-traceable tables; JSONB would be the first deviation from that
-- convention for no compensating benefit, and would make it impossible
-- for a Release line to reference "which exact tier was applied"
-- (source_pricing_tier_id) with real referential integrity.
--
-- tax_rate lives here (per item) — unlike currency (agreement header,
-- migration 128), tax legitimately differs between items on the same
-- agreement (different VAT categories).

CREATE TABLE agreement_pricing (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_item_id UUID          NOT NULL UNIQUE REFERENCES agreement_items(id) ON DELETE CASCADE,
  pricing_type      TEXT          NOT NULL CHECK (pricing_type IN ('fixed', 'discount_percent', 'tiered', 'rule_based')),
  unit_price        NUMERIC(14,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  discount_percent  NUMERIC(5,2)  CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent < 100)),
  tax_rate          NUMERIC(5,2)  CHECK (tax_rate IS NULL OR tax_rate >= 0),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
ALTER TABLE agreement_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_pricing
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_pricing TO service_role;

-- Only populated when pricing_type = 'tiered'. 'rule_based' has no
-- table yet — a future sibling table (e.g. agreement_pricing_rules)
-- can be added later with zero change to this one, same incremental
-- pattern used for every extension this session (PR -> RFQ -> Award).
CREATE TABLE agreement_pricing_tiers (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_pricing_id UUID          NOT NULL REFERENCES agreement_pricing(id) ON DELETE CASCADE,
  tier_order           INTEGER       NOT NULL,
  min_quantity         NUMERIC(14,4) NOT NULL CHECK (min_quantity >= 0),
  max_quantity         NUMERIC(14,4) CHECK (max_quantity IS NULL OR max_quantity > min_quantity),
  unit_price           NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
  discount_percent     NUMERIC(5,2)  CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent < 100)),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_pricing_id, tier_order)
);
CREATE INDEX idx_agreement_pricing_tiers_pricing ON agreement_pricing_tiers(agreement_pricing_id);
ALTER TABLE agreement_pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_pricing_tiers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_pricing_tiers TO service_role;
