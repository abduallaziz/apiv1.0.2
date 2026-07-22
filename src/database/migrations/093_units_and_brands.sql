-- =============================================================================
-- 093 — Units and Brands (flat reference-data tables, same shape as `categories`)
-- =============================================================================
-- Part of Products Module rebuild, Phase A. Deliberately NOT adding
-- unit_id/brand_id columns to `items` yet (explicit user decision) — these
-- tables are standalone reference data until the Item domain design is
-- finalized. Units may later need purchase-unit/sale-unit/conversion support,
-- so no FK from items is wired up prematurely.
-- =============================================================================

CREATE TABLE units (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  symbol     TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,               -- never written; required by ScopedRepository filter
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE brands (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,               -- never written; required by ScopedRepository filter
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE units  ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_session_isolation ON units
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON brands
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
