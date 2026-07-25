-- Purchasing #9.5.1: Purchasing Agreement — the root document, ONE
-- supplier per agreement (a commercial contract is bilateral by nature;
-- a future multi-supplier "framework" would be a NEW parent table
-- grouping several single-supplier agreements, never a many-to-many on
-- this table — additive, no redesign needed here).
--
-- Currency lives on the HEADER (one currency per agreement — a
-- commercial instrument, same reasoning as purchase_orders having no
-- per-line currency). ARCHITECTURAL ASSUMPTION (documented per review):
-- every financial computation in this design (committed_value,
-- remaining_value, amendment deltas, release snapshots) assumes
-- Agreement = Single Currency for its entire lifetime. Changing an
-- agreement's currency is done via Renewal (a brand new agreement,
-- renewed_from_agreement_id), never via Amendment — Amendment has no
-- currency field at all, because currency is agreement identity, not a
-- negotiable term. A future Multi-Currency Framework Agreement is a
-- genuine structural extension (per-currency value partitioning + an
-- FX-rate layer that doesn't exist anywhere in this schema), not a
-- simple column addition.
--
-- No 'awarded'/'active'/'completed' status — validity is
-- effective_date/expiration_date/auto_expire (checked at write-time,
-- never a background job flipping status), and consumption-completion
-- is a query over agreement_release_items, never a stored status.
--
-- Renewal lineage (A -> B -> C -> D) is reconstructed via recursive
-- traversal of renewed_from_agreement_id (each row only needs to know
-- its own immediate predecessor) — not a separately stored chain table.

CREATE TABLE agreements (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id               UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  agreement_number          TEXT        NOT NULL,
  currency                  TEXT        NOT NULL DEFAULT 'SAR',
  status                    TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'closed', 'cancelled')),
  effective_date            DATE,
  expiration_date           DATE,
  auto_expire               BOOLEAN     NOT NULL DEFAULT true,
  overage_policy            TEXT        NOT NULL DEFAULT 'block' CHECK (overage_policy IN ('block', 'warn', 'require_approval', 'allow')),
  renewed_from_agreement_id UUID        REFERENCES agreements(id) ON DELETE SET NULL,
  notes                     TEXT,
  created_by                UUID        REFERENCES users(id),
  approved_by               UUID        REFERENCES users(id),
  approved_at               TIMESTAMPTZ,
  deleted_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_agreements_tenant_number ON agreements(tenant_id, agreement_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_agreements_tenant_status ON agreements(tenant_id, status) WHERE deleted_at IS NULL;
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreements
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreements TO service_role;

-- Open Blanket (no ceiling at all) = both committed_quantity AND
-- committed_value NULL. Either, both, or neither may be set.
-- added_via_amendment_id / discontinued_via_amendment_id / discontinued_at
-- are added by a later migration (9.5.3), once agreement_amendments exists.
CREATE TABLE agreement_items (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_id       UUID          NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  committed_quantity NUMERIC(14,4) CHECK (committed_quantity IS NULL OR committed_quantity > 0),
  committed_value    NUMERIC(14,4) CHECK (committed_value IS NULL OR committed_value > 0),
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agreement_items_agreement ON agreement_items(agreement_id);
ALTER TABLE agreement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_items TO service_role;
