-- Migration 13.21 Phase 2 — Sefay Universal Device Platform: Database
-- Foundation.
--
-- Architecture principle (enforced by design, not just comment): this
-- migration creates ONLY new scanner-platform tables. It does not add a
-- single column to, or alter a single constraint on, any existing
-- protected table (items, item_barcodes, warehouse_locations, item_batches,
-- item_serials, stock_levels, stock_movements, cost_layers,
-- stock_reservations, pick_lists, warehouse_tasks, stock_transfers,
-- stock_counts). The scanner platform reads those tables (via the Resolver
-- Engine, Phase 5) and calls their EXISTING services (via the Action
-- Framework, Phase 7) — it never writes to them directly, and this
-- migration adds no FK, trigger, or function that would let it.

-- ============================================================
-- 1. scanner_devices — registered hardware
-- ============================================================
CREATE TABLE scanner_devices (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_code        TEXT          NOT NULL,
  name               TEXT          NOT NULL,
  device_type        TEXT          NOT NULL CHECK (device_type IN ('usb_hid', 'bluetooth', 'camera', 'zebra', 'honeywell', 'sunmi', 'rfid', 'generic')),
  status             TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'disabled')),
  assigned_to        UUID          REFERENCES users(id) ON DELETE SET NULL,
  assigned_warehouse_id UUID       REFERENCES warehouses(id) ON DELETE SET NULL,
  last_seen_at       TIMESTAMPTZ,
  health_status      TEXT          NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'offline', 'unknown')),
  metadata           JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_by         UUID          REFERENCES users(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_scanner_devices_tenant_code ON scanner_devices(tenant_id, device_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_scanner_devices_status ON scanner_devices(tenant_id, status) WHERE deleted_at IS NULL;
ALTER TABLE scanner_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_devices
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_devices TO service_role;

-- ============================================================
-- 2. scanner_device_capabilities — what a device can scan
-- ============================================================
CREATE TABLE scanner_device_capabilities (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id   UUID        NOT NULL REFERENCES scanner_devices(id) ON DELETE CASCADE,
  capability  TEXT        NOT NULL CHECK (capability IN ('barcode_1d', 'barcode_2d', 'rfid', 'camera', 'bluetooth')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, capability)
);
CREATE INDEX idx_scanner_device_capabilities_device ON scanner_device_capabilities(tenant_id, device_id);
ALTER TABLE scanner_device_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_device_capabilities
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_device_capabilities TO service_role;

-- ============================================================
-- 3. scanner_sessions — a workflow session on a device
-- ============================================================
CREATE TABLE scanner_sessions (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id      UUID        NOT NULL REFERENCES scanner_devices(id) ON DELETE RESTRICT,
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  warehouse_id   UUID        REFERENCES warehouses(id) ON DELETE SET NULL,
  workflow_type  TEXT        NOT NULL CHECK (workflow_type IN ('receiving', 'putaway', 'picking', 'packing', 'shipping', 'transfer', 'counting', 'manufacturing')),
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ
);
CREATE INDEX idx_scanner_sessions_device ON scanner_sessions(tenant_id, device_id, status);
CREATE INDEX idx_scanner_sessions_user ON scanner_sessions(tenant_id, user_id, status);
ALTER TABLE scanner_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_sessions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_sessions TO service_role;

-- ============================================================
-- 4. scanner_events — raw scan ingestion (immutable, append-only,
--    same pattern as stock_movements — migration 017)
-- ============================================================
CREATE TABLE scanner_events (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id           UUID          NOT NULL REFERENCES scanner_sessions(id) ON DELETE CASCADE,
  device_id            UUID          NOT NULL REFERENCES scanner_devices(id) ON DELETE RESTRICT,
  -- Client-generated idempotency key: the SAME scan replayed (retry, or
  -- offline-queue replay, Phase 9) must never be double-counted. NULL is
  -- allowed for adapters that can't generate one, in which case dedup
  -- falls back to no protection for that event (documented risk, not a
  -- silent gap — flagged in the Action Framework's own idempotency check).
  client_event_id      TEXT,
  raw_value            TEXT          NOT NULL,
  event_type           TEXT          NOT NULL CHECK (event_type IN ('barcode', 'rfid', 'manual')),
  resolved_entity_type TEXT          CHECK (resolved_entity_type IN ('item', 'location', 'batch', 'serial', 'unresolved')),
  resolved_entity_id   UUID,
  status               TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'failed', 'duplicate')),
  error_message        TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_scanner_events_idempotency ON scanner_events(tenant_id, device_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX idx_scanner_events_session ON scanner_events(tenant_id, session_id, created_at);
CREATE INDEX idx_scanner_events_status ON scanner_events(tenant_id, status);
ALTER TABLE scanner_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_events TO service_role;

-- Immutability: same principle as stock_movements (migration 017) — a
-- scan event is a factual record of what happened; it is never edited or
-- deleted, only ever superseded by a new event.
CREATE OR REPLACE FUNCTION fn_block_scanner_events_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'scanner_events is an immutable ledger — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_scanner_events_no_update BEFORE UPDATE ON scanner_events FOR EACH ROW EXECUTE FUNCTION fn_block_scanner_events_mutation();
CREATE TRIGGER trg_scanner_events_no_delete BEFORE DELETE ON scanner_events FOR EACH ROW EXECUTE FUNCTION fn_block_scanner_events_mutation();

-- ============================================================
-- 5. scanner_actions — what the Action Framework did with a
--    resolved event (which EXISTING Sefay service/endpoint it called)
-- ============================================================
CREATE TABLE scanner_actions (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            UUID          NOT NULL REFERENCES scanner_events(id) ON DELETE CASCADE,
  action_type         TEXT          NOT NULL,
  target_service      TEXT          NOT NULL, -- e.g. 'GoodsReceiptsService.post', 'WmsService.confirmPick' — human-readable, not a code reference
  target_reference_type TEXT,
  target_reference_id UUID,
  status              TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  result_summary       JSONB,
  error_message        TEXT,
  executed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scanner_actions_event ON scanner_actions(tenant_id, event_id);
CREATE INDEX idx_scanner_actions_target ON scanner_actions(tenant_id, target_reference_type, target_reference_id) WHERE target_reference_id IS NOT NULL;
ALTER TABLE scanner_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_actions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_actions TO service_role;

-- ============================================================
-- 6. scanner_audit_logs — immutable audit trail (device/session/
--    action lifecycle), separate from the generic audit_logs table
--    (whose actor is always a user) since a scanner audit entry's
--    actor can be a device acting autonomously (e.g. offline sync).
-- ============================================================
CREATE TABLE scanner_audit_logs (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type   TEXT        NOT NULL CHECK (actor_type IN ('device', 'user')),
  actor_id     UUID        NOT NULL,
  action       TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID,
  details      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scanner_audit_logs_entity ON scanner_audit_logs(tenant_id, entity_type, entity_id);
CREATE INDEX idx_scanner_audit_logs_actor ON scanner_audit_logs(tenant_id, actor_type, actor_id);
ALTER TABLE scanner_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_audit_logs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_audit_logs TO service_role;

CREATE TRIGGER trg_scanner_audit_logs_no_update BEFORE UPDATE ON scanner_audit_logs FOR EACH ROW EXECUTE FUNCTION fn_block_scanner_events_mutation();
CREATE TRIGGER trg_scanner_audit_logs_no_delete BEFORE DELETE ON scanner_audit_logs FOR EACH ROW EXECUTE FUNCTION fn_block_scanner_events_mutation();

-- ============================================================
-- 7. scanner_sync_queue — offline event queue (Phase 9). A queued
--    payload is the same shape an online scan event would carry; the
--    Sync Engine replays it through the identical Resolver->Action
--    path (per the approved data-integrity rule), never a shortcut.
-- ============================================================
CREATE TABLE scanner_sync_queue (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id     UUID          NOT NULL REFERENCES scanner_devices(id) ON DELETE CASCADE,
  session_id    UUID          REFERENCES scanner_sessions(id) ON DELETE SET NULL,
  client_event_id TEXT,
  payload       JSONB         NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'syncing', 'synced', 'failed')),
  attempts      INTEGER       NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  synced_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_scanner_sync_queue_idempotency ON scanner_sync_queue(tenant_id, device_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX idx_scanner_sync_queue_status ON scanner_sync_queue(tenant_id, status);
ALTER TABLE scanner_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON scanner_sync_queue
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.scanner_sync_queue TO service_role;

-- ============================================================
-- Rollback (documented, not auto-executed — per the plan's own
-- "rollback procedures" hardening requirement):
--
-- DROP TABLE IF EXISTS scanner_sync_queue;
-- DROP TABLE IF EXISTS scanner_audit_logs;
-- DROP TABLE IF EXISTS scanner_actions;
-- DROP TABLE IF EXISTS scanner_events;
-- DROP FUNCTION IF EXISTS fn_block_scanner_events_mutation();
-- DROP TABLE IF EXISTS scanner_sessions;
-- DROP TABLE IF EXISTS scanner_device_capabilities;
-- DROP TABLE IF EXISTS scanner_devices;
--
-- Safe to run in full only if no real scan data has been recorded yet —
-- scanner_events/scanner_audit_logs are immutable ledgers by design, so a
-- rollback after real usage would destroy audit history, same caveat as
-- every other immutable-ledger table in this schema (stock_movements,
-- quality_status_history, etc.).
-- ============================================================
