-- Purchasing #9.5.3: Amendments — delta-only change documents, never a
-- rewrite of the agreement. Three, and only three, things an amendment
-- can do:
--   1. MODIFY an existing agreement_item -> a row here with deltas
--      (delta_committed_quantity/delta_committed_value are additive;
--      new_unit_price/new_discount_percent are overrides — the most
--      recently APPROVED one wins, by approved_at ordering).
--   2. ADD a brand-new item to the agreement -> a genuine new row is
--      inserted directly into agreement_items (tagged
--      added_via_amendment_id), never represented inside this table —
--      it becomes an ordinary agreement_item from that point on.
--   3. DISCONTINUE an existing item -> a soft flag on agreement_items
--      (discontinued_via_amendment_id/discontinued_at) blocking future
--      Releases against it — NEVER a hard DELETE, which would break
--      the history of any Release already drawn against it.
--
-- Eligibility to CREATE an amendment is NOT a single status gate on the
-- agreement — it depends on amendment_type (enforced at the application
-- layer via one explicit, centralized rule, not scattered in code):
--   - Commercial types (quantity_change/value_change/price_change/
--     extension/general) require the agreement to be 'approved' (a live
--     commercial relationship being renegotiated).
--   - 'administrative_correction' is allowed regardless of the
--     agreement's status (draft/approved/closed/cancelled/rejected) --
--     it corrects the RECORD, not the commercial relationship, so it
--     never depends on whether that relationship is still active.
--
-- new_expiration_date lives on the amendment itself (not
-- agreement_amendment_items) because an 'extension' amendment changes
-- the whole agreement's validity, not one specific line. Currency has
-- no field here at all, anywhere -- a genuine currency change is a
-- Renewal (migration 128), never an Amendment.

CREATE TABLE agreement_amendments (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_id        UUID        NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  amendment_number    TEXT        NOT NULL,
  amendment_type      TEXT        NOT NULL CHECK (amendment_type IN ('quantity_change', 'value_change', 'price_change', 'extension', 'administrative_correction', 'general')),
  status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  new_expiration_date DATE,
  notes               TEXT,
  created_by          UUID        REFERENCES users(id),
  approved_by         UUID        REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_agreement_amendments_tenant_number ON agreement_amendments(tenant_id, amendment_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_agreement_amendments_agreement ON agreement_amendments(agreement_id, status);
ALTER TABLE agreement_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_amendments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_amendments TO service_role;

CREATE TABLE agreement_amendment_items (
  id                       UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amendment_id             UUID          NOT NULL REFERENCES agreement_amendments(id) ON DELETE CASCADE,
  agreement_item_id        UUID          NOT NULL REFERENCES agreement_items(id) ON DELETE RESTRICT,
  delta_committed_quantity NUMERIC(14,4),
  delta_committed_value    NUMERIC(14,4),
  new_unit_price           NUMERIC(14,4) CHECK (new_unit_price IS NULL OR new_unit_price >= 0),
  new_discount_percent     NUMERIC(5,2)  CHECK (new_discount_percent IS NULL OR (new_discount_percent >= 0 AND new_discount_percent < 100)),
  notes                    TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agreement_amendment_items_amendment ON agreement_amendment_items(amendment_id);
ALTER TABLE agreement_amendment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_amendment_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_amendment_items TO service_role;

-- Now that agreement_amendments exists, wire the item-add/discontinue
-- traceability columns onto agreement_items (migration 128).
ALTER TABLE agreement_items ADD COLUMN added_via_amendment_id UUID REFERENCES agreement_amendments(id) ON DELETE SET NULL;
ALTER TABLE agreement_items ADD COLUMN discontinued_via_amendment_id UUID REFERENCES agreement_amendments(id) ON DELETE SET NULL;
ALTER TABLE agreement_items ADD COLUMN discontinued_at TIMESTAMPTZ;
