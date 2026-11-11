-- 250. Fixes a confirmed defect in fn_confirm_warehouse_task (migration
-- 223), found via F11 (Warehouse Task Management UI) live QA validation.
--
-- Root cause: the history INSERT hardcoded the literal string
-- 'in_progress' as old_status instead of capturing the task's real prior
-- status before the UPDATE ... RETURNING statement overwrote v_task —
-- the exact same bug class migration 223's own comment says was fixed for
-- fn_cancel_warehouse_task ("the old version logged old_status=new_status
-- ='cancelled' ... Fixed by capturing the real prior status before the
-- UPDATE, consistent with every other function in this file"), but missed
-- here. Confirmed live: confirming an 'assigned' task's first quantity
-- recorded {old_status:'in_progress', new_status:'in_progress'} instead
-- of {old_status:'assigned', new_status:'in_progress'}.
--
-- Fix: capture v_task.status into v_old_status BEFORE the UPDATE,
-- mirroring fn_cancel_warehouse_task's own v_old_status pattern exactly,
-- then use that captured value as old_status in the history INSERT.
-- No other logic touched — quantity accumulation, completion-status
-- derivation, stock movements, and permissions are byte-for-byte
-- unchanged from migration 223.

CREATE OR REPLACE FUNCTION fn_confirm_warehouse_task(
  p_task_id UUID, p_tenant_id UUID, p_quantity NUMERIC, p_confirmed_location_id UUID, p_actor_id UUID
) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
  v_old_status TEXT;
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

  v_old_status := v_task.status;

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
  VALUES (p_tenant_id, 'warehouse_task', p_task_id, v_old_status, v_new_status, p_actor_id);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;
