-- 249. Fixes a confirmed defect in fn_wms_wave_shipment_summary (migration
-- 244), found via F9 (Wave Evaluation Review) browser validation.
--
-- Root cause: the 'excluded' count used
--   excluded_reason ->> 'reason' <> 'claim_failed_at_release'
-- Real evaluation-time exclusions (written by fn_evaluate_wave_
-- eligibility, migration 232) never contain a 'reason' key at all — only
-- fn_release_wave's claim_failed_at_release path (migration 238) sets
-- one. So for a genuine evaluation exclusion, excluded_reason ->> 'reason'
-- is SQL NULL, and `NULL <> 'claim_failed_at_release'` evaluates to NULL
-- — which a FILTER clause treats as false, silently dropping every real
-- evaluation-time exclusion from the 'excluded' count. Confirmed live:
-- a wave with one genuine excluded shipment
-- (excluded_reason = {"route":"WEST","priority":"low",
--  "route_required":"EAST","priority_min_required":"medium"}, no
-- "reason" key) reported 'excluded': 0 while the per-shipment
-- excluded_reason row was real and correctly non-null.
--
-- Fix: `<>` is not NULL-safe; `IS DISTINCT FROM` is. Replacing the one
-- operator makes the exact same three-way split work correctly:
--   - included_reason IS NOT NULL                                -> eligible (unchanged)
--   - excluded_reason IS NOT NULL AND reason IS DISTINCT FROM
--     'claim_failed_at_release' (including the common case where the
--     'reason' key is absent entirely)                            -> excluded (evaluation-time)
--   - excluded_reason ->> 'reason' = 'claim_failed_at_release'      -> failed_at_release (unchanged)
-- The three categories remain mutually exclusive and exhaustive over
-- excluded_reason IS NOT NULL rows — no double counting, no regression
-- to the failed_at_release semantics (its own filter was never affected
-- by this bug, since `= 'x'` already correctly treats NULL as no-match).

CREATE OR REPLACE FUNCTION fn_wms_wave_shipment_summary(
  p_wave_id   UUID,
  p_tenant_id UUID
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'wave_id', p_wave_id,
    'eligible', COUNT(*) FILTER (WHERE included_reason IS NOT NULL),
    'excluded', COUNT(*) FILTER (WHERE excluded_reason IS NOT NULL AND (excluded_reason ->> 'reason') IS DISTINCT FROM 'claim_failed_at_release'),
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
