-- Migration 13.19 Part 3 — Quality Hold Management upgrade (Phase 2/5 of
-- the approved design): batch/location/serial tracking, disposition,
-- full history, and the hold/release RPCs that wrap the hard-block
-- primitives added in migrations 163/164.

ALTER TABLE quality_holds ADD COLUMN location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL;
ALTER TABLE quality_holds ADD COLUMN batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL;
ALTER TABLE quality_holds ADD COLUMN serial_id UUID REFERENCES item_serials(id) ON DELETE SET NULL;
ALTER TABLE quality_holds ADD COLUMN source_document_type TEXT CHECK (source_document_type IN ('goods_receipt', 'stock_count', 'production_order', 'manual'));
ALTER TABLE quality_holds ADD COLUMN source_document_id UUID;
ALTER TABLE quality_holds ADD COLUMN disposition TEXT CHECK (disposition IN ('accept', 'reject', 'scrap', 'rework', 'return_supplier', 'use_as_is'));
ALTER TABLE quality_holds ADD COLUMN disposition_notes TEXT;

-- 'released' already existed (migration 145); widen to add 'rejected' for
-- the Release/Reject workflow the approved design requires (a hold review
-- can end in either outcome — reject means the disposition stands and the
-- held quantity does NOT return to availability; see fn_reject_quality_hold).
ALTER TABLE quality_holds DROP CONSTRAINT quality_holds_status_check;
ALTER TABLE quality_holds ADD CONSTRAINT quality_holds_status_check CHECK (status IN ('active', 'released', 'rejected'));

CREATE TABLE quality_hold_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hold_id     UUID        NOT NULL REFERENCES quality_holds(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('created', 'released', 'rejected')),
  actor_id    UUID        REFERENCES users(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_hold_history_hold ON quality_hold_history(tenant_id, hold_id);
ALTER TABLE quality_hold_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_hold_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_hold_history TO service_role;

-- Generic quality-status audit trail (per the "Audit Trail" requirement),
-- shared across inspections/holds/NCR/CAPA/deviations via a polymorphic
-- reference, same pattern as approval_history/audit_logs.
CREATE TABLE quality_status_history (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_type TEXT        NOT NULL CHECK (reference_type IN ('inspection', 'hold', 'non_conformance', 'corrective_action', 'deviation')),
  reference_id   UUID        NOT NULL,
  old_status     TEXT,
  new_status     TEXT        NOT NULL,
  actor_id       UUID        REFERENCES users(id),
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_status_history_reference ON quality_status_history(tenant_id, reference_type, reference_id);
ALTER TABLE quality_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_status_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_status_history TO service_role;

-- Creates a hold AND applies the hard block in one transaction: inserts
-- quality_holds (status='active'), posts a real 'quality_hold' movement via
-- the existing fn_apply_stock_movement (163/164 — on_hand unchanged, cost
-- layers untouched, quantity_available reduced), and records history.
-- p_quantity_held, if NULL, defaults to the item's full current
-- quantity_available at hold time (pragmatic default for "hold everything").
CREATE OR REPLACE FUNCTION fn_create_quality_hold(
  p_tenant_id             UUID,
  p_warehouse_id          UUID,
  p_item_id               UUID,
  p_variant_id            UUID,
  p_location_id           UUID,
  p_batch_id              UUID,
  p_serial_id             UUID,
  p_quantity_held         NUMERIC,
  p_reason                TEXT,
  p_source_document_type  TEXT,
  p_source_document_id    UUID,
  p_quality_inspection_id UUID,
  p_created_by            UUID
) RETURNS quality_holds AS $$
DECLARE
  v_qty NUMERIC;
  v_hold_id UUID := uuid_generate_v4();
  v_hold quality_holds;
BEGIN
  IF p_quantity_held IS NULL THEN
    SELECT quantity_available INTO v_qty FROM v_stock_balance
     WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND item_id = p_item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     LIMIT 1;
    v_qty := GREATEST(COALESCE(v_qty, 0), 0);
  ELSE
    v_qty := p_quantity_held;
  END IF;

  -- id pre-generated so the stock_movements audit row (immutable — no
  -- UPDATE is ever possible, migration 017) can carry the correct
  -- reference_id from the moment it's created, instead of a two-step
  -- create-then-backfill that would require mutating the ledger.
  INSERT INTO quality_holds (
    id, tenant_id, warehouse_id, item_id, variant_id, location_id, batch_id, serial_id,
    quantity_held, status, reason, source_document_type, source_document_id,
    quality_inspection_id, created_by
  ) VALUES (
    v_hold_id, p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_location_id, p_batch_id, p_serial_id,
    v_qty, 'active', p_reason, p_source_document_type, p_source_document_id,
    p_quality_inspection_id, p_created_by
  ) RETURNING * INTO v_hold;

  IF v_qty > 0 THEN
    PERFORM fn_apply_stock_movement(
      p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id,
      'quality_hold', 'out', v_qty, 0,
      'quality_hold', v_hold_id, p_created_by, false
    );
  END IF;

  IF p_serial_id IS NOT NULL THEN
    -- Serial-level holds are also reflected on item_serials.status so a
    -- serial lookup shows its quality state directly (no join needed).
    UPDATE item_serials SET status = 'in_stock', updated_at = NOW() WHERE id = p_serial_id;
  END IF;

  INSERT INTO quality_hold_history (tenant_id, hold_id, action, actor_id, reason)
  VALUES (p_tenant_id, v_hold.id, 'created', p_created_by, p_reason);

  RETURN v_hold;
END;
$$ LANGUAGE plpgsql;

-- Releases a hold: reverses the hard block via 'quality_release' (restores
-- quantity_available exactly), sets status='released', records history.
CREATE OR REPLACE FUNCTION fn_release_quality_hold(
  p_hold_id    UUID,
  p_tenant_id  UUID,
  p_actor_id   UUID,
  p_reason     TEXT
) RETURNS quality_holds AS $$
DECLARE
  v_hold quality_holds;
BEGIN
  SELECT * INTO v_hold FROM quality_holds WHERE id = p_hold_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quality hold % not found', p_hold_id;
  END IF;
  IF v_hold.status <> 'active' THEN
    RAISE EXCEPTION 'quality hold % is not active (status=%)', p_hold_id, v_hold.status;
  END IF;

  IF v_hold.quantity_held > 0 THEN
    PERFORM fn_apply_stock_movement(
      p_tenant_id, v_hold.warehouse_id, v_hold.location_id, v_hold.item_id, v_hold.variant_id, v_hold.batch_id,
      'quality_release', 'in', v_hold.quantity_held, 0,
      'quality_hold', p_hold_id, p_actor_id, false
    );
  END IF;

  UPDATE quality_holds
     SET status = 'released', released_by = p_actor_id, released_at = NOW()
   WHERE id = p_hold_id
   RETURNING * INTO v_hold;

  INSERT INTO quality_hold_history (tenant_id, hold_id, action, actor_id, reason)
  VALUES (p_tenant_id, p_hold_id, 'released', p_actor_id, p_reason);

  RETURN v_hold;
END;
$$ LANGUAGE plpgsql;

-- Rejects a hold: the disposition stands (reject/scrap/return_supplier/etc)
-- and the held quantity does NOT return to availability — it remains
-- permanently excluded until a separate physical write-off/adjustment
-- (existing 'damage'/'adjustment_out' movement types) removes it from
-- on_hand entirely. This function only changes quality_holds.status; it
-- deliberately does not touch stock_levels, since "rejected" is a business
-- decision about disposition, not a change in what physically exists.
CREATE OR REPLACE FUNCTION fn_reject_quality_hold(
  p_hold_id     UUID,
  p_tenant_id   UUID,
  p_actor_id    UUID,
  p_disposition TEXT,
  p_reason      TEXT
) RETURNS quality_holds AS $$
DECLARE
  v_hold quality_holds;
BEGIN
  SELECT * INTO v_hold FROM quality_holds WHERE id = p_hold_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quality hold % not found', p_hold_id;
  END IF;
  IF v_hold.status <> 'active' THEN
    RAISE EXCEPTION 'quality hold % is not active (status=%)', p_hold_id, v_hold.status;
  END IF;

  UPDATE quality_holds
     SET status = 'rejected', released_by = p_actor_id, released_at = NOW(),
         disposition = p_disposition, disposition_notes = p_reason
   WHERE id = p_hold_id
   RETURNING * INTO v_hold;

  INSERT INTO quality_hold_history (tenant_id, hold_id, action, actor_id, reason)
  VALUES (p_tenant_id, p_hold_id, 'rejected', p_actor_id, p_reason);

  RETURN v_hold;
END;
$$ LANGUAGE plpgsql;
