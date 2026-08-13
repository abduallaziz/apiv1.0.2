-- Migration 13.20 Part 2 — Putaway Engine + Warehouse Tasks (Putaway and
-- Replenishment only, per the approved architectural decision — Picking,
-- Transfers, and Stock Counts keep their own existing, complete models
-- unchanged).

-- Putaway Rules: configuration only, same sparse-filter matching pattern as
-- quality_rules (migration 165) — NULL on a filter column means "matches
-- anything" for that dimension. priority (lower = matched first) resolves
-- ties when more than one rule could apply.
CREATE TABLE putaway_rules (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT          NOT NULL,
  warehouse_id            UUID          REFERENCES warehouses(id) ON DELETE CASCADE,
  applies_to_item_id      UUID          REFERENCES items(id) ON DELETE CASCADE,
  applies_to_category_id  UUID          REFERENCES categories(id) ON DELETE CASCADE,
  target_location_purpose TEXT          NOT NULL DEFAULT 'storage' CHECK (target_location_purpose IN (
                             'receiving', 'storage', 'picking', 'packing', 'quality_hold', 'damaged', 'shipping'
                           )),
  target_location_id      UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  priority                INTEGER       NOT NULL DEFAULT 100,
  is_active               BOOLEAN       NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_putaway_rules_lookup ON putaway_rules(tenant_id, warehouse_id) WHERE is_active = true;
ALTER TABLE putaway_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON putaway_rules
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.putaway_rules TO service_role;

-- Replenishment Rules: min/max quantity at a picking location, sourced from
-- a storage location. Same shape/intent as inventory_reorder_points but
-- scoped to location-to-location movement within a warehouse, not
-- external purchasing.
CREATE TABLE warehouse_replenishment_rules (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id          UUID          NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  item_id               UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id            UUID          REFERENCES item_variants(id) ON DELETE CASCADE,
  destination_location_id UUID        NOT NULL REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  -- NOT NULL deliberately: replenishment is strictly a move of existing
  -- stock from a storage location, never a receipt — a rule with no real
  -- source cannot be created (see fn_confirm_warehouse_task's matching guard).
  source_location_id    UUID          NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  min_quantity          NUMERIC(14,4) NOT NULL CHECK (min_quantity >= 0),
  max_quantity          NUMERIC(14,4) NOT NULL CHECK (max_quantity > 0),
  is_active              BOOLEAN      NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_replenishment_min_lt_max CHECK (min_quantity < max_quantity)
);
CREATE UNIQUE INDEX uq_replenishment_rule_location ON warehouse_replenishment_rules(
  tenant_id, warehouse_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), destination_location_id
) WHERE is_active = true;
ALTER TABLE warehouse_replenishment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_replenishment_rules
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_replenishment_rules TO service_role;

-- Warehouse Tasks: ONLY for Putaway and Replenishment (per the approved
-- decision — Picking already has pick_lists, Transfers/Counting keep their
-- own complete models). One shared table+lifecycle for these two new
-- capabilities since they're structurally identical: move N of an item
-- from a source to a destination location, assigned to a user, tracked
-- through completion.
CREATE TABLE warehouse_tasks (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id          UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  task_type             TEXT          NOT NULL CHECK (task_type IN ('putaway', 'replenishment')),
  source_document_type  TEXT          CHECK (source_document_type IN ('goods_receipt', 'replenishment_rule', 'manual')),
  source_document_id    UUID,
  item_id               UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id            UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  batch_id              UUID          REFERENCES item_batches(id) ON DELETE SET NULL,
  quantity               NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  quantity_completed     NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_completed >= 0),
  source_location_id     UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  suggested_location_id  UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  confirmed_location_id  UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  priority                TEXT         NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status                  TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
  assigned_to             UUID         REFERENCES users(id),
  created_by              UUID         REFERENCES users(id),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_warehouse_task_completed_le_quantity CHECK (quantity_completed <= quantity)
);
CREATE INDEX idx_warehouse_tasks_status ON warehouse_tasks(tenant_id, warehouse_id, task_type, status);
CREATE INDEX idx_warehouse_tasks_assigned ON warehouse_tasks(tenant_id, assigned_to) WHERE status IN ('assigned', 'in_progress');
ALTER TABLE warehouse_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_tasks
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_tasks TO service_role;

CREATE TABLE warehouse_task_history (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id      UUID        NOT NULL REFERENCES warehouse_tasks(id) ON DELETE CASCADE,
  old_status   TEXT,
  new_status   TEXT        NOT NULL,
  actor_id     UUID        REFERENCES users(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_warehouse_task_history_task ON warehouse_task_history(tenant_id, task_id);
ALTER TABLE warehouse_task_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_task_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_task_history TO service_role;

-- Resolves the best-matching putaway rule for an item (most specific wins:
-- item > category > warehouse-only), and validates the suggested location's
-- capacity (max_quantity) against its current occupied quantity + the
-- incoming putaway quantity. Read-only — never writes, never creates a task.
CREATE OR REPLACE FUNCTION fn_suggest_putaway_location(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_category_id  UUID,
  p_quantity     NUMERIC
) RETURNS TABLE (rule_id UUID, location_id UUID, capacity_ok BOOLEAN) AS $$
  WITH matched AS (
    SELECT pr.id, pr.target_location_id
    FROM putaway_rules pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.is_active = true
      AND (pr.warehouse_id IS NULL OR pr.warehouse_id = p_warehouse_id)
      AND (pr.applies_to_item_id IS NULL OR pr.applies_to_item_id = p_item_id)
      AND (pr.applies_to_category_id IS NULL OR pr.applies_to_category_id = p_category_id)
      AND pr.target_location_id IS NOT NULL
    ORDER BY (pr.applies_to_item_id IS NOT NULL) DESC, (pr.applies_to_category_id IS NOT NULL) DESC, pr.priority ASC
    LIMIT 1
  )
  SELECT
    m.id, m.target_location_id,
    (wl.max_quantity IS NULL OR fn_location_occupied_quantity(p_tenant_id, m.target_location_id) + p_quantity <= wl.max_quantity)
  FROM matched m
  JOIN warehouse_locations wl ON wl.id = m.target_location_id;
$$ LANGUAGE sql STABLE;

-- Creates a putaway task from a Goods Receipt line (or manually). Does NOT
-- move stock — the goods receipt's own posting (fn_post_goods_receipt,
-- unmodified) already placed the item wherever its line specified; this
-- task tracks the physical relocation from that (often a receiving-purpose
-- location) to the suggested/confirmed storage location.
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

  INSERT INTO warehouse_task_history (tenant_id, task_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, v_task.id, NULL, 'pending', p_created_by);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

-- Assigns a pending/assigned task to a user, moves to 'assigned' (or
-- 'in_progress' if already started). Generic — used by both putaway and
-- replenishment tasks.
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

  INSERT INTO warehouse_task_history (tenant_id, task_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, p_task_id, 'pending', 'assigned', p_actor_id);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

-- Confirms placement: for putaway, physically reclassifies the location on
-- stock_levels for the confirmed quantity (an ordinary location-to-location
-- move — reuses fn_apply_stock_movement's existing 'adjustment_out'/
-- 'adjustment_in' pair scoped to the same warehouse, so cost_layers and the
-- ledger stay authoritative; NOT a new movement type). Marks the task
-- in_progress on first confirm, completed once quantity_completed = quantity.
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
  -- Replenishment is strictly a location-to-location move of EXISTING
  -- stock, never a receipt — unlike putaway (whose source may legitimately
  -- be unset, e.g. goods received with no location recorded yet), a
  -- replenishment task with no source_location_id would silently create
  -- phantom stock (an 'in' movement with no matching 'out'). Refuse instead.
  IF v_task.task_type = 'replenishment' AND v_task.source_location_id IS NULL THEN
    RAISE EXCEPTION 'replenishment task % has no source_location_id — cannot confirm without a real source', p_task_id;
  END IF;

  -- Physical relocation within the same warehouse: move quantity from the
  -- source location's stock_level row to the confirmed location's, via the
  -- existing 'adjustment_out'/'adjustment_in' movement types — no new
  -- inventory primitive invented, and this never crosses warehouses (that's
  -- what stock_transfers is for, untouched).
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

  INSERT INTO warehouse_task_history (tenant_id, task_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, p_task_id, 'in_progress', v_new_status, p_actor_id);

  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_cancel_warehouse_task(p_task_id UUID, p_tenant_id UUID, p_actor_id UUID) RETURNS warehouse_tasks AS $$
DECLARE
  v_task warehouse_tasks;
BEGIN
  SELECT * INTO v_task FROM warehouse_tasks WHERE id = p_task_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse task % not found', p_task_id; END IF;
  IF v_task.status = 'completed' THEN RAISE EXCEPTION 'task % already completed, cannot cancel', p_task_id; END IF;

  UPDATE warehouse_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = p_task_id RETURNING * INTO v_task;
  INSERT INTO warehouse_task_history (tenant_id, task_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, p_task_id, v_task.status, 'cancelled', p_actor_id);
  RETURN v_task;
END;
$$ LANGUAGE plpgsql;

-- Replenishment: checks every active rule for a picking-location shortage
-- (current stock at destination_location_id < min_quantity) and creates a
-- replenishment task moving (max_quantity - current) from source_location_id
-- if one is configured. Read/write — call periodically or on-demand; does
-- not auto-run on a schedule (no cron infrastructure assumed).
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
      -- Skip if an open (pending/assigned/in_progress) replenishment task
      -- already exists for this exact rule — avoid duplicate tasks on repeat checks.
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

        INSERT INTO warehouse_task_history (tenant_id, task_id, old_status, new_status, actor_id)
        VALUES (p_tenant_id, v_task.id, NULL, 'pending', p_created_by);

        RETURN NEXT v_task;
      END IF;
    END IF;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql;
