-- Inventory #7 / 7-9 (Owner-approved) — Scalability verification fix.
--
-- Measured, not speculative: EXPLAIN (ANALYZE, BUFFERS) at a real 50,000-
-- shipment / ~100,000-shipment_line / ~63,500-reservation QA dataset
-- showed two of the eight 7-8 visibility RPCs degrade nonlinearly between
-- 10k and 50k scale, while the other six stayed flat/sub-linear:
--
--   fn_wms_shipment_overview:     30ms (10k rows) -> 2,910ms (50k rows)
--   fn_wms_reservation_overview:  ~2ms (10k rows) -> 2,102ms (50k rows)
--
-- Root cause for both: a full sequential scan of a table with no index on
-- tenant_id at all (shipment_lines), and a table whose only relevant
-- index is a partial one that doesn't cover the full status range being
-- aggregated (stock_reservations' idx_reservations_active is
-- WHERE status = 'active' only, but fn_wms_reservation_overview's outer
-- FROM aggregates every status). Confirmed directly: shipment_lines had
-- zero rows from other tenants inflating the scan — the cost is real,
-- from this one tenant's own row count, not shared-environment noise.
--
-- Both fixes are additive indexes only. No function body changes, no
-- output/semantics change — same aggregation logic, same result shape.

CREATE INDEX idx_shipment_lines_tenant ON shipment_lines(tenant_id, shipment_id);

CREATE INDEX idx_reservations_tenant_warehouse ON stock_reservations(tenant_id, warehouse_id);
