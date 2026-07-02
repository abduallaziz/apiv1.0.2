-- =============================================================================
-- 016. INVENTORY CORE — warehouses, locations, suppliers, batches, reorder points
-- Enterprise Inventory Management: foundational master-data tables.
-- =============================================================================

CREATE TABLE warehouses (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id  UUID        REFERENCES branches(id) ON DELETE SET NULL,
  code       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  address    TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_warehouses_tenant_code ON warehouses(tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_warehouses_tenant ON warehouses(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE warehouse_locations (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id UUID        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code         TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  zone         TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_locations_warehouse_code ON warehouse_locations(warehouse_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_locations_tenant ON warehouse_locations(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE suppliers (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  tax_number    TEXT,
  payment_terms TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id) WHERE deleted_at IS NULL;

-- Batch / serial / expiration tracking unit. A row represents either a batch
-- (quantity tracked via stock_levels/cost_layers referencing batch_id) or a
-- single serialized unit (serial_number set, quantity is always 1 downstream).
CREATE TABLE item_batches (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id          UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id       UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  batch_number     TEXT,
  serial_number    TEXT,
  supplier_id      UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  manufactured_date DATE,
  expiration_date  DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_batch_has_identifier CHECK (batch_number IS NOT NULL OR serial_number IS NOT NULL)
);
CREATE UNIQUE INDEX uq_batches_tenant_batch_number
  ON item_batches(tenant_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), batch_number)
  WHERE batch_number IS NOT NULL;
CREATE UNIQUE INDEX uq_batches_tenant_serial
  ON item_batches(tenant_id, serial_number)
  WHERE serial_number IS NOT NULL;
CREATE INDEX idx_batches_item ON item_batches(tenant_id, item_id);
CREATE INDEX idx_batches_expiration ON item_batches(tenant_id, expiration_date) WHERE expiration_date IS NOT NULL;

CREATE TABLE inventory_reorder_points (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id    UUID        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  item_id         UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id      UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  min_quantity    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  max_quantity    NUMERIC(14,4) CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
  reorder_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_reorder_points_scope
  ON inventory_reorder_points(tenant_id, warehouse_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_reorder_points_tenant ON inventory_reorder_points(tenant_id) WHERE is_active = true;

-- Per-item costing configuration. Inventory module is the single source of
-- truth for quantity/cost going forward — items.cost_price/stock_quantity
-- and item_variants.stock_quantity become legacy/read-only (see migration 023).
ALTER TABLE items
  ADD COLUMN costing_method   TEXT NOT NULL DEFAULT 'fifo' CHECK (costing_method IN ('fifo','average')),
  ADD COLUMN track_batches    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN track_serial     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN track_expiration BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN items.cost_price IS 'LEGACY default cost — superseded by inventory cost_layers as of migration 016. Do not write to this column from application code.';
COMMENT ON COLUMN item_variants.stock_quantity IS 'LEGACY — superseded by inventory.stock_levels as of migration 016. Do not write to this column from application code.';

ALTER TABLE warehouses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_batches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reorder_points ENABLE ROW LEVEL SECURITY;
