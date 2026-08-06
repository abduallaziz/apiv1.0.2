-- Migration 8.2 — Quality Management foundation (#19).
--
-- Three new tables (quality_inspections, quality_holds, non_conformances)
-- and one new read-only RPC (fn_check_quality_holds). Quality holds are
-- deliberately advisory only — no column is added to stock_levels/
-- stock_movements/cost_layers, and nothing here can block a sale (see
-- invoices.service.ts integration, application-layer only).
--
-- reference_type/reference_id on quality_inspections is polymorphic
-- (goods_receipt or stock_count), matching the same pattern already used by
-- approval_history (121) and stock_movements — no literal cross-table FK is
-- possible for a polymorphic reference, consistent with existing precedent.

CREATE TABLE quality_inspections (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_type TEXT          NOT NULL CHECK (reference_type IN ('goods_receipt', 'stock_count')),
  reference_id   UUID          NOT NULL,
  item_id        UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id     UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  status         TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'conditional')),
  inspected_by   UUID          REFERENCES users(id),
  inspected_at   TIMESTAMPTZ,
  notes          TEXT,
  created_by     UUID          REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_inspections_reference ON quality_inspections(tenant_id, reference_type, reference_id);
CREATE INDEX idx_quality_inspections_item ON quality_inspections(tenant_id, item_id);
ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_inspections
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_inspections TO service_role;

CREATE TABLE quality_holds (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id          UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id               UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id            UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_held         NUMERIC(14,4) CHECK (quantity_held IS NULL OR quantity_held > 0),
  status                TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  reason                TEXT,
  quality_inspection_id UUID          REFERENCES quality_inspections(id) ON DELETE SET NULL,
  created_by            UUID          REFERENCES users(id),
  released_by           UUID          REFERENCES users(id),
  released_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
-- The exact lookup fn_check_quality_holds performs — active holds only,
-- scoped to (tenant, warehouse, item, variant).
CREATE INDEX idx_quality_holds_active_lookup
  ON quality_holds(tenant_id, warehouse_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active';
ALTER TABLE quality_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_holds
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_holds TO service_role;

CREATE TABLE non_conformances (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quality_inspection_id UUID        NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  item_id               UUID        NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  description           TEXT        NOT NULL,
  severity              TEXT        NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  status                TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  resolved_by           UUID        REFERENCES users(id),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_non_conformances_inspection ON non_conformances(tenant_id, quality_inspection_id);
ALTER TABLE non_conformances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON non_conformances
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.non_conformances TO service_role;

-- Advisory-only lookup used by InvoicesService before (not during/inside)
-- fn_process_sale_stock_deduction — read-only, never blocks, never mutates.
CREATE OR REPLACE FUNCTION fn_check_quality_holds(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_items        JSONB
)
RETURNS TABLE (
  item_id    UUID,
  variant_id UUID,
  item_name  TEXT,
  hold_id    UUID,
  reason     TEXT
) AS $$
  SELECT
    qh.item_id,
    qh.variant_id,
    i.name AS item_name,
    qh.id AS hold_id,
    qh.reason
  FROM jsonb_to_recordset(p_items) AS x(item_id UUID, variant_id UUID)
  JOIN quality_holds qh
    ON qh.tenant_id = p_tenant_id
    AND qh.warehouse_id = p_warehouse_id
    AND qh.item_id = x.item_id
    AND COALESCE(qh.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(x.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND qh.status = 'active'
  JOIN items i ON i.id = qh.item_id;
$$ LANGUAGE sql STABLE;
