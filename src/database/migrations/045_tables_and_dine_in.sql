-- Phase 10F — Tables & Orders (restaurants/cafes): tables, dine-in open tabs,
-- Kitchen Display System (item prep status), reservations, waitlist.
--
-- Design decision: dine-in orders reuse the existing `orders`/`order_items` tables
-- (via new orders.table_id + the already-existing but previously unused 'pending'
-- status) rather than a separate `table_orders` entity — a table's running tab IS
-- an order, just one that stays open across multiple item-adding rounds before
-- final checkout. This reuses the existing POS engine/payment/loyalty/stock
-- deduction pipeline instead of duplicating it.

CREATE TABLE tables (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  capacity    INTEGER     NOT NULL DEFAULT 2 CHECK (capacity > 0),
  status      TEXT        NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning')),
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_tables_tenant_branch_name ON tables(tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_tables_tenant_branch ON tables(tenant_id, branch_id) WHERE deleted_at IS NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES tables(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(tenant_id, table_id) WHERE table_id IS NOT NULL;
-- At most one open (pending) order per table at a time.
CREATE UNIQUE INDEX uq_orders_open_per_table ON orders(table_id) WHERE table_id IS NOT NULL AND status = 'pending';

-- Kitchen Display System: per-item prep status. NULL = not a kitchen-tracked item
-- (e.g. rung up outside a table context); tracked items default to 'pending' on insert.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS kitchen_status TEXT
    CHECK (kitchen_status IS NULL OR kitchen_status IN ('pending', 'preparing', 'ready', 'served'));

CREATE TABLE table_reservations (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_id         UUID        NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  customer_name    TEXT        NOT NULL,
  customer_phone   TEXT,
  party_size       INTEGER     NOT NULL DEFAULT 1 CHECK (party_size > 0),
  reservation_time TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'confirmed'
                               CHECK (status IN ('confirmed', 'seated', 'cancelled', 'no_show')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reservations_tenant_time ON table_reservations(tenant_id, reservation_time);
CREATE INDEX idx_reservations_table ON table_reservations(table_id, reservation_time);

CREATE TABLE waitlist_entries (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id            UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  customer_name        TEXT        NOT NULL,
  customer_phone       TEXT,
  party_size           INTEGER     NOT NULL DEFAULT 1 CHECK (party_size > 0),
  quoted_wait_minutes  INTEGER,
  status               TEXT        NOT NULL DEFAULT 'waiting'
                                   CHECK (status IN ('waiting', 'seated', 'cancelled')),
  table_id             UUID        REFERENCES tables(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seated_at            TIMESTAMPTZ
);
CREATE INDEX idx_waitlist_tenant_branch_status ON waitlist_entries(tenant_id, branch_id, status);
