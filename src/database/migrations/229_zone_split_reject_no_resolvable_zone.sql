-- 229. Inventory #7 / 7-3 final business decision (Owner-approved,
-- Option A) — fn_create_zone_pick_lists_for_shipments must reject
-- atomically, before any shipment claim or state change, when zero of
-- the given shipments' lines resolve to any valid zone. Previously it
-- claimed every shipment unconditionally, then discovered zones — a
-- shipment with no resolvable zone was silently left claimed with zero
-- pick lists created (a confirmed edge-case gap, not a hidden decision).
--
-- Fixed by resolving the distinct zone set FIRST (read-only, no locks,
-- no claims), before the shipment-validation/claim loop. If it's empty,
-- RAISE EXCEPTION aborts the whole function — Postgres functions execute
-- inside the caller's transaction, so nothing this function did (nothing,
-- in this case, since the claim loop never ran) persists. Atomic by
-- construction, not by a compensating rollback step.
CREATE OR REPLACE FUNCTION fn_create_zone_pick_lists_for_shipments(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_shipment_ids UUID[],
  p_actor_id     UUID,
  p_priority     TEXT DEFAULT 'medium'
) RETURNS SETOF pick_lists AS $$
DECLARE
  v_shipment  shipments;
  v_zone_id   UUID;
  v_zone_ids  UUID[];
  v_pick_list pick_lists;
  v_line      RECORD;
  v_pll       pick_list_lines;
  v_reservation stock_reservations;
  v_found_count INTEGER;
BEGIN
  IF array_length(p_shipment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one shipment is required';
  END IF;

  SELECT COUNT(*) INTO v_found_count
    FROM shipments
   WHERE id = ANY(p_shipment_ids) AND tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id;
  IF v_found_count < array_length(p_shipment_ids, 1) THEN
    RAISE EXCEPTION 'one or more shipment ids were not found in warehouse %', p_warehouse_id;
  END IF;

  -- Read-only zone discovery BEFORE any lock/claim/mutation — Option A
  -- (Owner-approved): reject atomically if nothing is resolvable, rather
  -- than claiming shipments and creating nothing.
  SELECT array_agg(DISTINCT resolved.zone_id) INTO v_zone_ids
  FROM (
    SELECT (
      WITH RECURSIVE ancestors AS (
        SELECT wl.id, wl.location_type, wl.parent_location_id
        FROM warehouse_locations wl
        WHERE wl.id = sl.location_id
        UNION ALL
        SELECT p.id, p.location_type, p.parent_location_id
        FROM warehouse_locations p
        JOIN ancestors a ON p.id = a.parent_location_id
      )
      SELECT id FROM ancestors WHERE location_type = 'zone' LIMIT 1
    ) AS zone_id
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(p_shipment_ids) AND sl.location_id IS NOT NULL
  ) resolved
  WHERE resolved.zone_id IS NOT NULL;

  IF v_zone_ids IS NULL OR array_length(v_zone_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ZONE_SPLIT_NO_RESOLVABLE_ZONE: none of the given shipments'' lines resolve to a valid picking zone — nothing to claim or split';
  END IF;

  -- Everything below is unchanged from the prior version: claim once,
  -- then build one pick list per zone already known to be real.
  FOR v_shipment IN SELECT * FROM shipments WHERE id = ANY(p_shipment_ids) FOR UPDATE LOOP
    IF v_shipment.tenant_id <> p_tenant_id THEN
      RAISE EXCEPTION 'shipment % not found', v_shipment.id;
    END IF;
    IF v_shipment.warehouse_id <> p_warehouse_id THEN
      RAISE EXCEPTION 'shipment % does not belong to warehouse %', v_shipment.id, p_warehouse_id;
    END IF;
    IF v_shipment.status <> 'pending' THEN
      RAISE EXCEPTION 'shipment % is not pending (status=%)', v_shipment.id, v_shipment.status;
    END IF;
    UPDATE shipments SET status = 'picking', updated_at = NOW() WHERE id = v_shipment.id;
  END LOOP;

  FOREACH v_zone_id IN ARRAY v_zone_ids LOOP
    INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, zone_location_id, priority, status, created_by, started_at)
    VALUES (p_tenant_id, p_warehouse_id, 'zone', v_zone_id, COALESCE(p_priority, 'medium'), 'in_progress', p_actor_id, NOW())
    RETURNING * INTO v_pick_list;

    INSERT INTO pick_list_shipments (tenant_id, pick_list_id, shipment_id)
    SELECT DISTINCT p_tenant_id, v_pick_list.id, sl.shipment_id
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(p_shipment_ids)
      AND fn_location_is_in_zone(sl.location_id, v_zone_id);

    FOR v_line IN
      SELECT sl.item_id, sl.variant_id, sl.location_id, SUM(sl.quantity_requested) AS total_qty
      FROM shipment_lines sl
      WHERE sl.shipment_id = ANY(p_shipment_ids)
        AND fn_location_is_in_zone(sl.location_id, v_zone_id)
      GROUP BY sl.item_id, sl.variant_id, sl.location_id
    LOOP
      INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
      VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
      RETURNING * INTO v_pll;

      v_reservation := fn_create_reservation(
        p_tenant_id, p_warehouse_id, v_line.item_id, v_line.variant_id, NULL,
        v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
      );

      UPDATE shipment_lines
         SET reservation_id = v_reservation.id
       WHERE shipment_id = ANY(p_shipment_ids)
         AND item_id = v_line.item_id
         AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND fn_location_is_in_zone(location_id, v_zone_id);
    END LOOP;

    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
    VALUES (p_tenant_id, 'pick_list', v_pick_list.id, NULL, 'in_progress', p_actor_id);

    RETURN NEXT v_pick_list;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;
