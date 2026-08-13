-- Migration 13.19 Part 5 — Supplier Quality (Phase 5/13) and Manufacturing
-- Quality Gate helper (Phase 6/14) of the approved design.
--
-- Supplier Quality is implemented as a VIEW, not a stored/refreshed table:
-- always accurate (no staleness, no refresh job to maintain), computed
-- directly from quality_inspections (via goods_receipt -> purchase_order ->
-- supplier_id, the existing FK chain) and non_conformances. This is a
-- deliberate engineering decision (per the approved "resolve implementation
-- conflicts through engineering decisions" instruction) — documented here
-- rather than silently built as a table the §23 list implied. No supplier
-- data is duplicated; suppliers itself is untouched.

CREATE OR REPLACE VIEW v_supplier_quality_scores AS
WITH gr_inspections AS (
  SELECT
    po.supplier_id,
    qi.tenant_id,
    qi.id AS inspection_id,
    qi.status
  FROM quality_inspections qi
  JOIN goods_receipts gr ON gr.id = qi.reference_id AND qi.reference_type = 'goods_receipt'
  JOIN purchase_orders po ON po.id = gr.purchase_order_id
  WHERE qi.status IN ('passed', 'failed', 'conditional')
),
ncr_counts AS (
  SELECT po.supplier_id, COUNT(nc.id) AS ncr_count
  FROM non_conformances nc
  JOIN quality_inspections qi ON qi.id = nc.quality_inspection_id
  JOIN goods_receipts gr ON gr.id = qi.reference_id AND qi.reference_type = 'goods_receipt'
  JOIN purchase_orders po ON po.id = gr.purchase_order_id
  GROUP BY po.supplier_id
)
SELECT
  gi.tenant_id,
  gi.supplier_id,
  s.name AS supplier_name,
  COUNT(*) AS total_inspections,
  COUNT(*) FILTER (WHERE gi.status = 'passed') AS passed_count,
  COUNT(*) FILTER (WHERE gi.status = 'failed') AS failed_count,
  COUNT(*) FILTER (WHERE gi.status = 'conditional') AS conditional_count,
  ROUND(COUNT(*) FILTER (WHERE gi.status = 'passed')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) AS pass_rate_percentage,
  ROUND(COUNT(*) FILTER (WHERE gi.status = 'failed')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) AS failure_rate_percentage,
  COALESCE(nc.ncr_count, 0) AS ncr_count
FROM gr_inspections gi
JOIN suppliers s ON s.id = gi.supplier_id
LEFT JOIN ncr_counts nc ON nc.supplier_id = gi.supplier_id
GROUP BY gi.tenant_id, gi.supplier_id, s.name, nc.ncr_count;

GRANT SELECT ON v_supplier_quality_scores TO service_role;

-- Manufacturing Quality Gate: resolves whether a completed production
-- order's output requires inspection before being treated as fully
-- available, using the same fn_resolve_quality_plan configuration as
-- Goods Receipt/Stock Count. Read-only — does NOT touch production
-- costing, the stock ledger, or fn_post_production_order in any way; the
-- application layer (ProductionOrdersService) calls this AFTER posting
-- completes (output already received into stock via the unmodified
-- fn_post_production_order) and only THEN optionally creates an inspection
-- + hold via the existing fn_create_quality_hold, exactly like a Goods
-- Receipt inspection would.
-- Returns zero rows if no quality_rules row matches (caller treats "no
-- row" as "inspection not required"), one row otherwise.
CREATE OR REPLACE FUNCTION fn_requires_manufacturing_inspection(
  p_tenant_id   UUID,
  p_item_id     UUID,
  p_warehouse_id UUID
) RETURNS TABLE (template_id UUID) AS $$
  SELECT r.template_id
  FROM fn_resolve_quality_plan(p_tenant_id, 'production_output', p_item_id, NULL, NULL, p_warehouse_id) r
  WHERE r.action = 'require_inspection';
$$ LANGUAGE sql STABLE;
