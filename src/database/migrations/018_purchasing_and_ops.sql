-- =============================================================================
-- 018. PURCHASING & INVENTORY OPERATIONS — purchase orders, goods receipts,
-- stock adjustments, two-phase transfers, stock counts, domain events outbox.
-- =============================================================================

CREATE TABLE purchase_orders (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id   UUID          NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id  UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  order_number  TEXT          NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN (
                   'draft','submitted','approved','partially_received','received','cancelled'
                 )),
  order_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  notes         TEXT,
  created_by    UUID          REFERENCES users(id),
  approved_by   UUID          REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_po_tenant_number ON purchase_orders(tenant_id, order_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_tenant_status ON purchase_orders(tenant_id, status) WHERE deleted_at IS NULL;

CREATE TABLE purchase_order_items (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id        UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_ordered  NUMERIC(14,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost         NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_poi_received_le_ordered CHECK (quantity_received <= quantity_ordered)
);
CREATE INDEX idx_poi_po ON purchase_order_items(purchase_order_id);

CREATE TABLE goods_receipts (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID        REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  warehouse_id      UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  receipt_number    TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  received_by       UUID        REFERENCES users(id),
  received_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_gr_tenant_number ON goods_receipts(tenant_id, receipt_number);
CREATE INDEX idx_gr_po ON goods_receipts(purchase_order_id) WHERE purchase_order_id IS NOT NULL;

CREATE TABLE goods_receipt_items (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goods_receipt_id        UUID          NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id  UUID          REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  item_id                 UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id              UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_received       NUMERIC(14,4) NOT NULL CHECK (quantity_received > 0),
  unit_cost               NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  batch_number            TEXT,
  serial_number           TEXT,
  expiration_date         DATE,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gri_receipt ON goods_receipt_items(goods_receipt_id);

CREATE TABLE stock_adjustments (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id       UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id           UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  quantity_delta     NUMERIC(14,4) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost          NUMERIC(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reason             TEXT          NOT NULL,
  status             TEXT          NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
                        'pending_approval','approved','rejected','posted'
                      )),
  requires_approval  BOOLEAN       NOT NULL DEFAULT false,
  requested_by       UUID          REFERENCES users(id),
  approved_by        UUID          REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  posted_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_adjustments_tenant_status ON stock_adjustments(tenant_id, status);

CREATE TABLE stock_transfers (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_warehouse_id UUID       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id   UUID       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  transfer_number  TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','completed','cancelled')),
  dispatched_by    UUID        REFERENCES users(id),
  dispatched_at    TIMESTAMPTZ,
  received_by      UUID        REFERENCES users(id),
  received_at      TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_transfer_different_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE UNIQUE INDEX uq_transfer_tenant_number ON stock_transfers(tenant_id, transfer_number);
CREATE INDEX idx_transfers_tenant_status ON stock_transfers(tenant_id, status);

CREATE TABLE stock_transfer_items (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_transfer_id UUID          NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id        UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id          UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  quantity          NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  dispatched_unit_cost NUMERIC(14,4),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transfer_items_transfer ON stock_transfer_items(stock_transfer_id);

CREATE TABLE stock_counts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id  UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  count_number  TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  started_by    UUID        REFERENCES users(id),
  started_at    TIMESTAMPTZ,
  completed_by  UUID        REFERENCES users(id),
  completed_at  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_count_tenant_number ON stock_counts(tenant_id, count_number);
CREATE INDEX idx_counts_tenant_status ON stock_counts(tenant_id, status);

CREATE TABLE stock_count_items (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_count_id     UUID          NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id           UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  location_id        UUID          REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  expected_quantity  NUMERIC(14,4) NOT NULL DEFAULT 0,
  counted_quantity   NUMERIC(14,4),
  variance           NUMERIC(14,4),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_count_items_count ON stock_count_items(stock_count_id);

-- Outbox pattern: domain events are written transactionally alongside the
-- inventory mutation (inside the same RPC function call) and relayed to
-- BullMQ asynchronously by the outbox worker (core/queue).
CREATE TABLE domain_events_outbox (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  aggregate_type TEXT        NOT NULL,
  aggregate_id   UUID        NOT NULL,
  payload        JSONB       NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  retry_count    INTEGER     NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON domain_events_outbox(status, created_at) WHERE status IN ('pending','failed');

ALTER TABLE purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events_outbox  ENABLE ROW LEVEL SECURITY;
