-- Purchasing #9.5.4: Release — a full independent business document
-- (own number, status lifecycle, approval fields, traceability), NOT a
-- CRUD-only consumption record. Consumption itself lives in
-- agreement_release_items as an append-only ledger — "remaining" is
-- always committed +/- amendment deltas − SUM(released across every
-- release), a query, never a stored running total.
--
-- effective_amendment_id records WHICH approved amendment (if any) was
-- in effect at the moment this release was created -- combined with the
-- per-line pricing snapshot below, this gives complete point-in-time
-- historical reconstruction years later without ever replaying the
-- amendment delta chain.
--
-- agreement_release_items snapshots pricing SERVER-SIDE at release time
-- (never client-submitted, same principle as award_items in 9.3) --
-- released_amount is a STORED financial snapshot output computed once
-- by the pricing engine, not a value re-derived on every read. This
-- matters because the calculation formula itself (how discount and tax
-- combine, rounding rules) could evolve later; if released_amount were
-- always recomputed live from its inputs using the CURRENT formula, a
-- future fix/change to that formula would silently restate historical
-- financial records. This mirrors the existing stock_movements.total_cost
-- pattern already used elsewhere in this project (stored, not
-- recomputed from unit_cost * quantity on every read).

CREATE TABLE agreement_releases (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_id          UUID        NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
  release_number        TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  effective_amendment_id UUID       REFERENCES agreement_amendments(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_by            UUID        REFERENCES users(id),
  approved_by           UUID        REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_agreement_releases_tenant_number ON agreement_releases(tenant_id, release_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_agreement_releases_agreement ON agreement_releases(agreement_id, status);
ALTER TABLE agreement_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_releases
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_releases TO service_role;

CREATE TABLE agreement_release_items (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  release_id            UUID          NOT NULL REFERENCES agreement_releases(id) ON DELETE CASCADE,
  agreement_item_id     UUID          NOT NULL REFERENCES agreement_items(id) ON DELETE RESTRICT,
  source_pricing_tier_id UUID         REFERENCES agreement_pricing_tiers(id) ON DELETE SET NULL,
  released_quantity     NUMERIC(14,4) NOT NULL CHECK (released_quantity > 0),
  snapshot_unit_price    NUMERIC(14,4) NOT NULL CHECK (snapshot_unit_price >= 0),
  snapshot_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (snapshot_discount_percent >= 0 AND snapshot_discount_percent < 100),
  snapshot_currency      TEXT          NOT NULL,
  snapshot_tax_rate      NUMERIC(5,2),
  released_amount        NUMERIC(14,4) NOT NULL CHECK (released_amount >= 0),
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agreement_release_items_release ON agreement_release_items(release_id);
CREATE INDEX idx_agreement_release_items_agreement_item ON agreement_release_items(agreement_item_id);
ALTER TABLE agreement_release_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON agreement_release_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.agreement_release_items TO service_role;
