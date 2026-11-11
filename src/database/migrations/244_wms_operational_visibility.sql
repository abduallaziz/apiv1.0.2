-- Inventory #7 / 7-8 (Owner-approved) — Operational Visibility / Aggregate
-- Queries. Pure read layer over the WMS execution state built in 7-1
-- through 7-7 (warehouse_tasks, pick_lists, waves, wave_shipments,
-- shipments, shipment_lines, stock_reservations, warehouse_exceptions,
-- backorders, warehouse_work_status_history). No new tables, no new
-- columns, no writes anywhere in this file — STABLE functions only.
--
-- All aggregation happens in SQL (grouped counts/sums via GROUP BY /
-- FILTER), never row-by-row in Node, per the approved 7-8 contract.
--
-- Many-to-many correctness: a shipment can belong to multiple pick lists
-- (zone-split, 7-3) and wave_shipments is a genuine many-to-many join
-- table (7-6). Every function below that counts shipments counts
-- DISTINCT shipments.id, never rows of a join table, so a zone-split
-- shipment is never double-counted merely because it has two
-- pick_list_shipments rows.
--
-- SLA: no authoritative SLA/threshold configuration exists anywhere in
-- the schema for warehouse_tasks/pick_lists/waves, so no "overdue"
-- metric is fabricated here. Only real created_at/completed_at-derived
-- durations are exposed (fn_wms_cycle_time_overview), per the explicit
-- instruction not to invent SLA thresholds.
--
-- Backorder boundary (7-7): warehouse-side backorder visibility is
-- sourced exclusively from warehouse_exceptions.resolution='backordered'
-- (the authoritative WMS-side representation). The separate order-level
-- backorders table is reported on its own, from its own source, with no
-- fabricated cross-link — the same boundary already established and
-- validated in 7-7's final verification.

-- Supporting index: pick_lists had no (tenant_id, warehouse_id) index —
-- every existing pick_lists index is either the PK or (tenant_id, status)
-- / (tenant_id, wave_id). Warehouse-scoped pick-list overview queries
-- would otherwise filter warehouse_id via a sequential scan.
CREATE INDEX idx_pick_lists_tenant_warehouse ON pick_lists(tenant_id, warehouse_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 1. Warehouse Work Overview (warehouse_tasks)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_task_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'assigned', COUNT(*) FILTER (WHERE status = 'assigned'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'open', COUNT(*) FILTER (WHERE status IN ('pending', 'assigned', 'in_progress')),
    'by_task_type', (
      SELECT COALESCE(jsonb_object_agg(task_type, cnt), '{}'::jsonb)
      FROM (
        SELECT task_type, COUNT(*) AS cnt
        FROM warehouse_tasks
        WHERE tenant_id = p_tenant_id
          AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
        GROUP BY task_type
      ) t
    ),
    'by_priority', (
      SELECT COALESCE(jsonb_object_agg(priority, cnt), '{}'::jsonb)
      FROM (
        SELECT priority, COUNT(*) AS cnt
        FROM warehouse_tasks
        WHERE tenant_id = p_tenant_id
          AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
          AND status IN ('pending', 'assigned', 'in_progress')
        GROUP BY priority
      ) t
    )
  )
  FROM warehouse_tasks
  WHERE tenant_id = p_tenant_id
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 2. Picking Overview (pick_lists)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_pick_list_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'open', COUNT(*) FILTER (WHERE status = 'open'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'assigned', COUNT(*) FILTER (WHERE assigned_to IS NOT NULL AND status IN ('open', 'in_progress')),
    'unassigned', COUNT(*) FILTER (WHERE assigned_to IS NULL AND status IN ('open', 'in_progress')),
    'by_priority', (
      SELECT COALESCE(jsonb_object_agg(priority, cnt), '{}'::jsonb)
      FROM (
        SELECT priority, COUNT(*) AS cnt
        FROM pick_lists
        WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
          AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
        GROUP BY priority
      ) t
    ),
    'by_strategy', (
      SELECT COALESCE(jsonb_object_agg(strategy, cnt), '{}'::jsonb)
      FROM (
        SELECT strategy, COUNT(*) AS cnt
        FROM pick_lists
        WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
          AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
        GROUP BY strategy
      ) t
    )
  )
  FROM pick_lists
  WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 3. Wave Overview (waves + wave_shipments many-to-many + shipments claim marker)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_wave_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'planning', COUNT(*) FILTER (WHERE status = 'planning'),
    'evaluating', COUNT(*) FILTER (WHERE status = 'evaluating'),
    'reviewing', COUNT(*) FILTER (WHERE status = 'reviewing'),
    'released', COUNT(*) FILTER (WHERE status = 'released'),
    'picking', COUNT(*) FILTER (WHERE status = 'picking'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'active', COUNT(*) FILTER (WHERE status IN ('planning', 'evaluating', 'reviewing', 'released', 'picking')),
    -- Sourced from wave_shipments (the real many-to-many join table), one
    -- row per (wave, shipment) — DISTINCT shipment_id per wave already
    -- guaranteed by uq_wave_shipment, so plain COUNT(*) here is correct,
    -- never double-counted by any other join.
    'eligible_shipments', (
      SELECT COUNT(*) FROM wave_shipments ws
      JOIN waves w ON w.id = ws.wave_id
      WHERE ws.tenant_id = p_tenant_id AND ws.included_reason IS NOT NULL
        AND (p_warehouse_id IS NULL OR w.warehouse_id = p_warehouse_id)
    ),
    'excluded_shipments', (
      SELECT COUNT(*) FROM wave_shipments ws
      JOIN waves w ON w.id = ws.wave_id
      WHERE ws.tenant_id = p_tenant_id AND ws.excluded_reason IS NOT NULL
        AND (p_warehouse_id IS NULL OR w.warehouse_id = p_warehouse_id)
    ),
    -- claim_failed_at_release is the exact marker fn_release_wave (237)
    -- writes when an included shipment fails to claim at release time.
    'failed_at_release_shipments', (
      SELECT COUNT(*) FROM wave_shipments ws
      JOIN waves w ON w.id = ws.wave_id
      WHERE ws.tenant_id = p_tenant_id
        AND ws.excluded_reason ->> 'reason' = 'claim_failed_at_release'
        AND (p_warehouse_id IS NULL OR w.warehouse_id = p_warehouse_id)
    ),
    -- The real claim marker (shipments.claimed_by_wave_id), authoritative
    -- over wave_shipments.included_reason for "is this shipment actually
    -- claimed right now" — distinct from eligible_shipments above.
    'claimed_shipments', (
      SELECT COUNT(*) FROM shipments s
      JOIN waves w ON w.id = s.claimed_by_wave_id
      WHERE s.tenant_id = p_tenant_id AND s.deleted_at IS NULL
        AND (p_warehouse_id IS NULL OR w.warehouse_id = p_warehouse_id)
    )
  )
  FROM waves
  WHERE tenant_id = p_tenant_id
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 4. Shipment Fulfillment Overview (shipments + shipment_lines quantities)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_shipment_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'picking', COUNT(*) FILTER (WHERE status = 'picking'),
    'picked', COUNT(*) FILTER (WHERE status = 'picked'),
    'packing', COUNT(*) FILTER (WHERE status = 'packing'),
    'packed', COUNT(*) FILTER (WHERE status = 'packed'),
    'shipped', COUNT(*) FILTER (WHERE status = 'shipped'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    -- 7-7 boundary: the authoritative WMS-side backorder signal is the
    -- warehouse_exceptions row itself, never a fabricated shipment-level
    -- status (shipments.status has no 'backordered' value — see 7-7 final
    -- report). Counts DISTINCT shipments reachable from a backordered
    -- exception via shipment_line -> shipment_id, not exception rows,
    -- since one shipment can carry more than one backordered exception.
    'backordered_shipments', (
      SELECT COUNT(DISTINCT sl.shipment_id)
      FROM warehouse_exceptions we
      JOIN shipment_lines sl ON sl.id = we.entity_id AND we.entity_type = 'shipment_line'
      JOIN shipments s ON s.id = sl.shipment_id
      WHERE we.tenant_id = p_tenant_id AND we.resolution = 'backordered'
        AND (p_warehouse_id IS NULL OR s.warehouse_id = p_warehouse_id)
    ),
    'quantities', (
      SELECT jsonb_build_object(
        'requested', COALESCE(SUM(sl.quantity_requested), 0),
        'picked', COALESCE(SUM(sl.quantity_picked), 0),
        'exception', COALESCE(SUM(sl.quantity_exception), 0),
        'unfulfilled', COALESCE(SUM(sl.quantity_requested - sl.quantity_picked - sl.quantity_exception), 0)
      )
      FROM shipment_lines sl
      JOIN shipments s ON s.id = sl.shipment_id
      WHERE sl.tenant_id = p_tenant_id AND s.deleted_at IS NULL
        AND (p_warehouse_id IS NULL OR s.warehouse_id = p_warehouse_id)
    )
  )
  FROM shipments
  WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 5. Exception Overview (warehouse_exceptions)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_exception_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_date_from    TIMESTAMPTZ DEFAULT NULL,
  p_date_to      TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
  WITH scoped AS (
    -- warehouse_exceptions has no warehouse_id column directly — scoped
    -- via its entity_id, resolving shipment_line -> shipment -> warehouse
    -- (the only entity_type this codebase's exception RPCs create today).
    -- Exceptions on other entity_types pass through unscoped by warehouse
    -- when p_warehouse_id is given (none exist yet; see drill-down notes).
    SELECT we.*
    FROM warehouse_exceptions we
    LEFT JOIN shipment_lines sl ON we.entity_type = 'shipment_line' AND sl.id = we.entity_id
    LEFT JOIN shipments s ON s.id = sl.shipment_id
    WHERE we.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR we.created_at >= p_date_from)
      AND (p_date_to IS NULL OR we.created_at < p_date_to)
      AND (
        p_warehouse_id IS NULL
        OR we.entity_type <> 'shipment_line'
        OR s.warehouse_id = p_warehouse_id
      )
  )
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'by_type', (
      SELECT COALESCE(jsonb_object_agg(exception_type, jsonb_build_object('count', cnt, 'quantity', qty)), '{}'::jsonb)
      FROM (
        SELECT exception_type, COUNT(*) AS cnt, COALESCE(SUM(affected_quantity), 0) AS qty
        FROM scoped GROUP BY exception_type
      ) t
    ),
    'resolved', COUNT(*) FILTER (WHERE status = 'resolved'),
    'open', COUNT(*) FILTER (WHERE status = 'open'),
    'backordered', COUNT(*) FILTER (WHERE resolution = 'backordered'),
    'total_affected_quantity', COALESCE(SUM(affected_quantity), 0),
    'top_reasons', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT reason, COUNT(*) AS cnt FROM scoped GROUP BY reason ORDER BY COUNT(*) DESC LIMIT 10
      ) t
    ),
    'volume_by_day', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', cnt) ORDER BY day), '[]'::jsonb)
      FROM (
        SELECT created_at::date AS day, COUNT(*) AS cnt FROM scoped GROUP BY created_at::date ORDER BY created_at::date
      ) t
    )
  )
  FROM scoped;
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 6. Inventory / Reservation Health (stock_reservations)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_reservation_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'active_count', COUNT(*) FILTER (WHERE status = 'active'),
    'active_quantity', COALESCE(SUM(quantity) FILTER (WHERE status = 'active'), 0),
    'released_count', COUNT(*) FILTER (WHERE status = 'released'),
    'consumed_count', COUNT(*) FILTER (WHERE status = 'consumed'),
    'expired_count', COUNT(*) FILTER (WHERE status = 'expired'),
    -- Reservation-release activity: how many active reservations were
    -- reduced (not fully released) by a 7-7 exception, i.e. a real
    -- partial-release event via fn_reduce_reservation. Derived from
    -- warehouse_exceptions rows that carry a reservation-affecting
    -- exception_type, never a fabricated "leakage" heuristic.
    'reservation_affecting_exceptions', (
      SELECT COUNT(*)
      FROM warehouse_exceptions we
      LEFT JOIN shipment_lines sl ON we.entity_type = 'shipment_line' AND sl.id = we.entity_id
      LEFT JOIN shipments s ON s.id = sl.shipment_id
      WHERE we.tenant_id = p_tenant_id
        AND we.exception_type IN ('short_pick', 'damaged', 'lost')
        AND (p_warehouse_id IS NULL OR we.entity_type <> 'shipment_line' OR s.warehouse_id = p_warehouse_id)
    )
  )
  FROM stock_reservations
  WHERE tenant_id = p_tenant_id
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 7. Wave drill-down: one wave's shipment breakdown (7-6 many-to-many, no
--    double counting — one row per wave_shipments entry, already unique
--    per (wave_id, shipment_id) via uq_wave_shipment).
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_wave_shipment_summary(
  p_wave_id   UUID,
  p_tenant_id UUID
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'wave_id', p_wave_id,
    'eligible', COUNT(*) FILTER (WHERE included_reason IS NOT NULL),
    'excluded', COUNT(*) FILTER (WHERE excluded_reason IS NOT NULL AND excluded_reason ->> 'reason' <> 'claim_failed_at_release'),
    'failed_at_release', COUNT(*) FILTER (WHERE excluded_reason ->> 'reason' = 'claim_failed_at_release'),
    'shipments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'shipment_id', ws.shipment_id,
        'status', s.status,
        'included_reason', ws.included_reason,
        'excluded_reason', ws.excluded_reason,
        'claimed', s.claimed_by_wave_id = p_wave_id
      ) ORDER BY ws.created_at), '[]'::jsonb)
      FROM wave_shipments ws
      JOIN shipments s ON s.id = ws.shipment_id
      WHERE ws.wave_id = p_wave_id AND ws.tenant_id = p_tenant_id
    )
  )
  FROM wave_shipments
  WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id;
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 8. Cycle-time visibility (real created_at -> completed_at durations
--    only — no fabricated SLA/overdue threshold, per the explicit
--    instruction not to invent one where no authoritative config exists).
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_wms_cycle_time_overview(
  p_tenant_id    UUID,
  p_entity_type  TEXT, -- 'warehouse_task' | 'pick_list' | 'wave'
  p_warehouse_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_entity_type NOT IN ('warehouse_task', 'pick_list', 'wave') THEN
    RAISE EXCEPTION 'invalid entity_type %, expected warehouse_task, pick_list, or wave', p_entity_type;
  END IF;

  IF p_entity_type = 'warehouse_task' THEN
    SELECT jsonb_build_object(
      'sample_size', COUNT(*),
      'avg_seconds', COALESCE(EXTRACT(EPOCH FROM AVG(completed_at - created_at)), 0),
      'min_seconds', COALESCE(EXTRACT(EPOCH FROM MIN(completed_at - created_at)), 0),
      'max_seconds', COALESCE(EXTRACT(EPOCH FROM MAX(completed_at - created_at)), 0)
    ) INTO v_result
    FROM warehouse_tasks
    WHERE tenant_id = p_tenant_id AND status = 'completed' AND completed_at IS NOT NULL
      AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
  ELSIF p_entity_type = 'pick_list' THEN
    SELECT jsonb_build_object(
      'sample_size', COUNT(*),
      'avg_seconds', COALESCE(EXTRACT(EPOCH FROM AVG(completed_at - created_at)), 0),
      'min_seconds', COALESCE(EXTRACT(EPOCH FROM MIN(completed_at - created_at)), 0),
      'max_seconds', COALESCE(EXTRACT(EPOCH FROM MAX(completed_at - created_at)), 0)
    ) INTO v_result
    FROM pick_lists
    WHERE tenant_id = p_tenant_id AND status = 'completed' AND completed_at IS NOT NULL AND deleted_at IS NULL
      AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
  ELSE
    SELECT jsonb_build_object(
      'sample_size', COUNT(*),
      'avg_seconds', COALESCE(EXTRACT(EPOCH FROM AVG(completed_at - created_at)), 0),
      'min_seconds', COALESCE(EXTRACT(EPOCH FROM MIN(completed_at - created_at)), 0),
      'max_seconds', COALESCE(EXTRACT(EPOCH FROM MAX(completed_at - created_at)), 0)
    ) INTO v_result
    FROM waves
    WHERE tenant_id = p_tenant_id AND status = 'completed' AND completed_at IS NOT NULL
      AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;
