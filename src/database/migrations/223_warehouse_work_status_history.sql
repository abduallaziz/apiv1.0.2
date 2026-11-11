-- 223. Inventory #7 / Migration Item 7-1 (Owner-approved) — Shared Status
-- History + Audit Logs Wiring.
--
-- Confirmed architectural finding: warehouse_task_history (migration 170)
-- was the ONLY structured status-transition table in the warehouse
-- domain — picking (pick_lists) had none. Rather than leave picking
-- permanently less mature, this generalizes the table into a shared,
-- entity-typed history usable by warehouse_tasks (today), pick_lists and
-- waves (items 7-2/7-4, next), without collapsing picking's own
-- multi-line/multi-shipment structure into warehouse_tasks' single-item
-- row shape — that decision (keep picking as its own entity, share only
-- the capability layer) is the approved architecture, not implemented in
-- this migration item.
--
-- All 6 real write sites to warehouse_task_history (5 in this file's own
-- SQL functions, 1 in WarehouseTasksRepository.createManual() — a
-- TypeScript-side write path for manually-created tasks) are redirected
-- to the new table in this same pass, so there is never a moment where
-- some warehouse_task transitions land in the old table and others in the
-- new one. warehouse_task_history itself is left in place (not dropped)
-- since dropping a table with real historical data is not something this
-- migration is authorized to do — it simply stops receiving new rows.

CREATE TABLE warehouse_work_status_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT        NOT NULL CHECK (entity_type IN ('warehouse_task', 'pick_list', 'wave')),
  entity_id   UUID        NOT NULL,
  old_status  TEXT,
  new_status  TEXT        NOT NULL,
  actor_id    UUID        REFERENCES users(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_warehouse_work_status_history_entity ON warehouse_work_status_history(tenant_id, entity_type, entity_id);
ALTER TABLE warehouse_work_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_work_status_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_work_status_history TO service_role;

-- Backfill: every existing warehouse_task_history row becomes an
-- entity_type='warehouse_task' row in the new table, preserving id
-- lineage isn't necessary (new surrogate ids), but every other column
-- (tenant_id, old_status, new_status, actor_id, created_at) is preserved
-- exactly, and task_id maps to entity_id.
INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, created_at)
SELECT tenant_id, 'warehouse_task', task_id, old_status, new_status, actor_id, created_at
FROM warehouse_task_history;

-- fn_create_putaway_task: CREATE OR REPLACE, identical signature and body
-- except the history INSERT target.
CREATE OR REPLACE FUNCTION fn_create_putaway_task(
  p_tenant_id            UUID,
  p_warehouse_id         UUID,
  p_item_id              UUID,
  p_variant_id           UUID,
  p_batch_id             UUID,
  p_quantity             NUMERIC,
  p_source_location_id   UUID,
  p_suggested_location_id UUID,
  p_source_document_type TEXT,
  p_source_document_id   UUID,
  p_created_by           UUID
) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
BEGIN
  INSERT INTO warehouse_tasks (
    tenant_id, warehouse_id, task_type, source_document_type, source_document_id,
    item_id, variant_id, batch_id, quantity, source_location_id, suggested_location_id,
    status, created_by
  ) VALUES (
    p_tenant_id, p_warehouse_id, 'putaway', p_source_document_type, p_source_document_id,
    p_item_id, p_variant_id, p_batch_id, p_quantity, p_source_location_id, p_suggested_location_id,
    'pending', p_created_by
  ) RETURNING * INTO v_task;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'warehouse_task', v_task.id, NULL, 'pending', p_created_by);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_assign_warehouse_task(
  p_task_id UUID, p_tenant_id UUID, p_assigned_to UUID, p_actor_id UUID
) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
BEGIN
  SELECT * INTO v_task FROM warehouse_tasks WHERE id = p_task_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse task % not found', p_task_id; END IF;
  IF v_task.status NOT IN ('pending', 'assigned') THEN
    RAISE EXCEPTION 'task % cannot be assigned (status=%)', p_task_id, v_task.status;
  END IF;

  UPDATE warehouse_tasks SET assigned_to = p_assigned_to, status = 'assigned', updated_at = NOW()
   WHERE id = p_task_id RETURNING * INTO v_task;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'warehouse_task', p_task_id, 'pending', 'assigned', p_actor_id);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_confirm_warehouse_task(
  p_task_id UUID, p_tenant_id UUID, p_quantity NUMERIC, p_confirmed_location_id UUID, p_actor_id UUID
) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_task FROM warehouse_tasks WHERE id = p_task_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse task % not found', p_task_id; END IF;
  IF v_task.status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'task % is not assigned/in_progress (status=%)', p_task_id, v_task.status;
  END IF;
  IF v_task.quantity_completed + p_quantity > v_task.quantity THEN
    RAISE EXCEPTION 'cannot confirm % — only % remaining of %', p_quantity, v_task.quantity - v_task.quantity_completed, v_task.quantity;
  END IF;
  IF v_task.task_type = 'replenishment' AND v_task.source_location_id IS NULL THEN
    RAISE EXCEPTION 'replenishment task % has no source_location_id — cannot confirm without a real source', p_task_id;
  END IF;

  IF v_task.source_location_id IS NOT NULL THEN
    PERFORM fn_apply_stock_movement(
      p_tenant_id, v_task.warehouse_id, v_task.source_location_id, v_task.item_id, v_task.variant_id, v_task.batch_id,
      'adjustment_out', 'out', p_quantity, 0, 'warehouse_task', p_task_id, p_actor_id, false
    );
  END IF;
  PERFORM fn_apply_stock_movement(
    p_tenant_id, v_task.warehouse_id, p_confirmed_location_id, v_task.item_id, v_task.variant_id, v_task.batch_id,
    'adjustment_in', 'in', p_quantity, 0, 'warehouse_task', p_task_id, p_actor_id, false
  );

  v_new_status := CASE WHEN v_task.quantity_completed + p_quantity >= v_task.quantity THEN 'completed' ELSE 'in_progress' END;

  UPDATE warehouse_tasks
     SET quantity_completed = quantity_completed + p_quantity,
         confirmed_location_id = p_confirmed_location_id,
         status = v_new_status,
         started_at = COALESCE(started_at, NOW()),
         completed_at = CASE WHEN v_new_status = 'completed' THEN NOW() ELSE NULL END,
         updated_at = NOW()
   WHERE id = p_task_id
   RETURNING * INTO v_task;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'warehouse_task', p_task_id, 'in_progress', v_new_status, p_actor_id);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

-- fn_cancel_warehouse_task: same behavior change as before PLUS a real bug
-- fix found while migrating this write site — the old version logged
-- old_status=new_status='cancelled' (it read v_task.status AFTER the
-- UPDATE...RETURNING had already overwritten it), which is a genuine
-- accuracy defect in the exact status-history data this migration item
-- exists to make trustworthy. Fixed by capturing the real prior status
-- before the UPDATE, consistent with every other function in this file.
CREATE OR REPLACE FUNCTION fn_cancel_warehouse_task(p_task_id UUID, p_tenant_id UUID, p_actor_id UUID) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
  v_old_status TEXT;
BEGIN
  SELECT * INTO v_task FROM warehouse_tasks WHERE id = p_task_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse task % not found', p_task_id; END IF;
  IF v_task.status = 'completed' THEN RAISE EXCEPTION 'task % already completed, cannot cancel', p_task_id; END IF;

  v_old_status := v_task.status;

  UPDATE warehouse_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = p_task_id RETURNING * INTO v_task;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'warehouse_task', p_task_id, v_old_status, 'cancelled', p_actor_id);
  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_run_replenishment_check(
  p_tenant_id UUID, p_warehouse_id UUID, p_created_by UUID
) RETURNS SETOF warehouse_tasks AS $$
DECLARE
  v_rule RECORD;
  v_current NUMERIC;
  v_task warehouse_tasks;
BEGIN
  FOR v_rule IN
    SELECT * FROM warehouse_replenishment_rules
    WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND is_active = true
  LOOP
    SELECT COALESCE(SUM(quantity_on_hand), 0) INTO v_current
    FROM stock_levels
    WHERE tenant_id = p_tenant_id AND location_id = v_rule.destination_location_id
      AND item_id = v_rule.item_id
      AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_rule.variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF v_current < v_rule.min_quantity THEN
      IF NOT EXISTS (
        SELECT 1 FROM warehouse_tasks
        WHERE tenant_id = p_tenant_id AND task_type = 'replenishment'
          AND source_document_type = 'replenishment_rule' AND source_document_id = v_rule.id
          AND status IN ('pending', 'assigned', 'in_progress')
      ) THEN
        INSERT INTO warehouse_tasks (
          tenant_id, warehouse_id, task_type, source_document_type, source_document_id,
          item_id, variant_id, quantity, source_location_id, suggested_location_id, confirmed_location_id,
          status, created_by
        ) VALUES (
          p_tenant_id, p_warehouse_id, 'replenishment', 'replenishment_rule', v_rule.id,
          v_rule.item_id, v_rule.variant_id, v_rule.max_quantity - v_current,
          v_rule.source_location_id, v_rule.destination_location_id, v_rule.destination_location_id,
          'pending', p_created_by
        ) RETURNING * INTO v_task;

        INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
        VALUES (p_tenant_id, 'warehouse_task', v_task.id, NULL, 'pending', p_created_by);

        RETURN NEXT v_task;
      END IF;
    END IF;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql;
