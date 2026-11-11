-- Inventory #7 / 7-8 fix — fn_wms_exception_overview's warehouse scoping
-- only resolved warehouse_id via entity_type='shipment_line' (through
-- shipment_lines -> shipments). warehouse_exceptions also has real rows
-- with entity_type='shipment' directly (fn_cancel_shipment, migration 239,
-- inserts entity_type='shipment', entity_id=shipment.id) — those bypassed
-- the warehouse filter entirely and leaked into every warehouse's
-- overview. Found via real QA validation: a cancellation exception
-- created in warehouse A appeared in warehouse B's overview query.
--
-- Fix: resolve warehouse_id for both entity_type values explicitly, no
-- other change to the aggregation logic.
CREATE OR REPLACE FUNCTION fn_wms_exception_overview(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_date_from    TIMESTAMPTZ DEFAULT NULL,
  p_date_to      TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
  WITH scoped AS (
    SELECT we.*
    FROM warehouse_exceptions we
    LEFT JOIN shipment_lines sl ON we.entity_type = 'shipment_line' AND sl.id = we.entity_id
    LEFT JOIN shipments s_via_line ON s_via_line.id = sl.shipment_id
    LEFT JOIN shipments s_direct ON we.entity_type = 'shipment' AND s_direct.id = we.entity_id
    WHERE we.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR we.created_at >= p_date_from)
      AND (p_date_to IS NULL OR we.created_at < p_date_to)
      AND (
        p_warehouse_id IS NULL
        OR (we.entity_type = 'shipment_line' AND s_via_line.warehouse_id = p_warehouse_id)
        OR (we.entity_type = 'shipment' AND s_direct.warehouse_id = p_warehouse_id)
        OR (we.entity_type NOT IN ('shipment_line', 'shipment'))
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

-- Same gap existed in fn_wms_reservation_overview's
-- reservation_affecting_exceptions sub-select, which only ever counts
-- exception_type IN ('short_pick','damaged','lost') — all three are
-- always entity_type='shipment_line' in this codebase's exception RPCs
-- (fn_record_short_pick/fn_record_damage/fn_record_lost_item all target
-- shipment_line), so no 'shipment'-typed row could ever match this
-- filter to begin with. No functional change needed there; documented
-- here for the audit trail since it was checked as part of this fix.
