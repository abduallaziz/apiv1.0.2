-- =============================================================================
-- 008: Phase 10C — Custom Customer Fields
-- Context: owners can define extra fields to capture per customer
-- (e.g. national ID, company name, birthday) beyond the fixed columns.
-- Values are stored in customers.custom_fields (JSONB) keyed by
-- customer_field_definitions.field_key so the schema stays flexible
-- without per-tenant ALTER TABLE.
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_capture_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS customer_field_definitions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_key    TEXT        NOT NULL,
  label_ar     TEXT        NOT NULL,
  label_en     TEXT        NOT NULL,
  field_type   TEXT        NOT NULL DEFAULT 'text'
                           CHECK (field_type IN ('text', 'number', 'date', 'select', 'boolean')),
  options      JSONB,                                  -- array of {value,label_ar,label_en} for field_type='select'
  required     BOOLEAN     NOT NULL DEFAULT false,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_field_definitions_tenant
  ON customer_field_definitions(tenant_id) WHERE deleted_at IS NULL;
