-- =============================================================================
-- 017. INVENTORY LEDGER — stock_movements (immutable), stock_levels (projection),
-- cost_layers (FIFO/average costing), stock_reservations.
-- =============================================================================

-- Immutable append-only ledger. Source of truth for all quantity changes.
CREATE TABLE stock_movements (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id   UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  location_id    UUID          REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  item_id        UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id     UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id       UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  movement_type  TEXT          NOT NULL CHECK (movement_type IN (
                    'receipt','sale','sale_return','adjustment_in','adjustment_out',
                    'transfer_out','transfer_in','count_correction_in','count_correction_out'
                  )),
  direction      TEXT          NOT NULL CHECK (direction IN ('in','out')),
  quantity       NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost      NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  total_cost     NUMERIC(16,4) NOT NULL,
  reference_type TEXT          NOT NULL,
  reference_id   UUID,
  occurred_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by     UUID          REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_movements_item_warehouse ON stock_movements(tenant_id, warehouse_id, item_id, variant_id, occurred_at);
CREATE INDEX idx_movements_reference ON stock_movements(tenant_id, reference_type, reference_id);
CREATE INDEX idx_movements_batch ON stock_movements(batch_id) WHERE batch_id IS NOT NULL;

-- Enforce immutability: no UPDATE or DELETE ever, by anyone (including service role).
CREATE OR REPLACE FUNCTION fn_block_stock_movements_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is an immutable ledger — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_no_update
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_block_stock_movements_mutation();

CREATE TRIGGER trg_stock_movements_no_delete
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_block_stock_movements_mutation();

-- Derived projection: current on-hand/reserved quantity per stocking point.
-- `version` enables optimistic concurrency checks from application code;
-- all mutations in practice go through SELECT...FOR UPDATE inside RPC functions
-- (migration 019), so version also serves as an auditable change counter.
CREATE TABLE stock_levels (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id      UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  location_id       UUID          REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id        UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id          UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  quantity_on_hand  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  version           BIGINT        NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_reserved_le_on_hand CHECK (quantity_reserved <= quantity_on_hand)
);
CREATE UNIQUE INDEX uq_stock_levels_point ON stock_levels(
  tenant_id, warehouse_id,
  COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  item_id,
  COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_stock_levels_item ON stock_levels(tenant_id, item_id, variant_id);
CREATE INDEX idx_stock_levels_warehouse ON stock_levels(tenant_id, warehouse_id);

-- FIFO cost layers. For 'average' costing items, a single synthetic layer per
-- (item,variant,warehouse) is maintained and its unit_cost is recomputed as a
-- weighted average on each receipt (see fn_add_cost_layer in migration 019).
CREATE TABLE cost_layers (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id        UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id             UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id          UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id            UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  source_movement_id  UUID          REFERENCES stock_movements(id),
  unit_cost           NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  quantity_received   NUMERIC(14,4) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining  NUMERIC(14,4) NOT NULL CHECK (quantity_remaining >= 0),
  received_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cost_layers_fifo ON cost_layers(tenant_id, warehouse_id, item_id, variant_id, received_at)
  WHERE quantity_remaining > 0;

CREATE TABLE stock_reservations (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id   UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id        UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id     UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id       UUID          REFERENCES item_batches(id) ON DELETE RESTRICT,
  quantity       NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  status         TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed','expired')),
  reference_type TEXT          NOT NULL,
  reference_id   UUID          NOT NULL,
  expires_at     TIMESTAMPTZ,
  created_by     UUID          REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  released_at    TIMESTAMPTZ
);
CREATE INDEX idx_reservations_active ON stock_reservations(tenant_id, warehouse_id, item_id, variant_id) WHERE status = 'active';
CREATE INDEX idx_reservations_reference ON stock_reservations(tenant_id, reference_type, reference_id);

ALTER TABLE stock_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_layers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
