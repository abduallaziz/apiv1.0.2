-- Migration 13.14 Phase 2 — supporting index for "search serial by number"
-- (SerialsController). The existing unique index on item_serials is
-- (tenant_id, item_id, serial_number) — a lookup that doesn't already know
-- item_id (the whole point of a serial-number search box) can't use it
-- efficiently. Read-only addition, no other schema change.
CREATE INDEX idx_item_serials_tenant_serial ON item_serials(tenant_id, serial_number) WHERE deleted_at IS NULL;
