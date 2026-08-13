-- Migration 13.19 Part 2 — Quality foundation: templates, plans, rules,
-- inspection extensions (Phase 1/3 of the approved design).

CREATE TABLE quality_templates (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  version     INTEGER     NOT NULL DEFAULT 1,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE quality_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_templates TO service_role;

-- Checklist items belonging to a template. check_type distinguishes a
-- pass/fail visual check from a measurement needing a tolerance range.
CREATE TABLE quality_template_checks (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id     UUID          NOT NULL REFERENCES quality_templates(id) ON DELETE CASCADE,
  sequence        INTEGER       NOT NULL DEFAULT 1,
  description     TEXT          NOT NULL,
  check_type      TEXT          NOT NULL DEFAULT 'pass_fail' CHECK (check_type IN ('pass_fail', 'measurement')),
  expected_value  NUMERIC(14,4),
  tolerance_min   NUMERIC(14,4),
  tolerance_max   NUMERIC(14,4),
  is_required     BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_template_checks_template ON quality_template_checks(template_id);
ALTER TABLE quality_template_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_template_checks
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_template_checks TO service_role;

-- Quality Rules: configuration-only. applies_to_* columns are all nullable
-- "match any" filters (NULL = matches everything for that dimension) —
-- the same sparse-filter pattern used by inventory_reorder_points'
-- item/variant scoping. action determines what happens when a matching
-- transaction occurs; template_id is required only for require_inspection.
CREATE TABLE quality_rules (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT          NOT NULL,
  applies_to_item_id     UUID         REFERENCES items(id) ON DELETE CASCADE,
  applies_to_category_id UUID         REFERENCES categories(id) ON DELETE CASCADE,
  applies_to_supplier_id UUID         REFERENCES suppliers(id) ON DELETE CASCADE,
  applies_to_warehouse_id UUID        REFERENCES warehouses(id) ON DELETE CASCADE,
  transaction_type      TEXT          CHECK (transaction_type IN ('goods_receipt', 'production_output', 'stock_count')),
  action                TEXT          NOT NULL CHECK (action IN ('require_inspection', 'create_hold', 'require_approval', 'apply_sampling')),
  template_id           UUID          REFERENCES quality_templates(id) ON DELETE SET NULL,
  sample_size_percent    NUMERIC(5,2) CHECK (sample_size_percent IS NULL OR (sample_size_percent > 0 AND sample_size_percent <= 100)),
  acceptance_defect_count INTEGER,
  is_active              BOOLEAN      NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT quality_rules_template_required_for_inspection CHECK (
    action <> 'require_inspection' OR template_id IS NOT NULL
  )
);
CREATE INDEX idx_quality_rules_lookup ON quality_rules(tenant_id, transaction_type) WHERE is_active = true;
ALTER TABLE quality_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_rules
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_rules TO service_role;

-- Quality Plans: the concrete, resolvable link a caller queries at
-- transaction time (Goods Receipt / Production Output / Stock Count) to
-- find which template applies and how to sample. Kept as its own table
-- (distinct from quality_rules, which is the broader "when" condition) so
-- a plan can be reused across multiple rules and referenced directly by
-- an inspection for full traceability (quality_inspections.plan_id).
CREATE TABLE quality_plans (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT          NOT NULL,
  template_id     UUID          NOT NULL REFERENCES quality_templates(id) ON DELETE RESTRICT,
  frequency       TEXT          NOT NULL DEFAULT 'every_transaction' CHECK (frequency IN ('every_transaction', 'sampling')),
  sample_size_percent    NUMERIC(5,2) CHECK (sample_size_percent IS NULL OR (sample_size_percent > 0 AND sample_size_percent <= 100)),
  acceptance_defect_count INTEGER,
  responsible_role TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
ALTER TABLE quality_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_plans
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_plans TO service_role;

-- Extend quality_inspections (migration 145): widen reference_type to
-- include production_order (Manufacturing Quality Gate), add template/plan
-- linkage, warehouse+quantity context (needed so a failed inspection can
-- auto-create a correctly-scoped quality_hold without a second lookup),
-- and sampling result fields.
ALTER TABLE quality_inspections DROP CONSTRAINT quality_inspections_reference_type_check;
ALTER TABLE quality_inspections ADD CONSTRAINT quality_inspections_reference_type_check
  CHECK (reference_type IN ('goods_receipt', 'stock_count', 'production_order'));

ALTER TABLE quality_inspections ADD COLUMN template_id UUID REFERENCES quality_templates(id) ON DELETE SET NULL;
ALTER TABLE quality_inspections ADD COLUMN plan_id UUID REFERENCES quality_plans(id) ON DELETE SET NULL;
ALTER TABLE quality_inspections ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE quality_inspections ADD COLUMN batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL;
ALTER TABLE quality_inspections ADD COLUMN quantity_inspected NUMERIC(14,4);
ALTER TABLE quality_inspections ADD COLUMN is_sampling BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quality_inspections ADD COLUMN sample_size NUMERIC(14,4);
ALTER TABLE quality_inspections ADD COLUMN defect_count INTEGER;

-- Per-checklist-item results for a completed inspection (matches
-- quality_template_checks 1:1 when the inspection used a template).
CREATE TABLE quality_results (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quality_inspection_id UUID      NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  template_check_id UUID          REFERENCES quality_template_checks(id) ON DELETE SET NULL,
  description       TEXT          NOT NULL,
  measured_value     NUMERIC(14,4),
  passed            BOOLEAN       NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_results_inspection ON quality_results(tenant_id, quality_inspection_id);
ALTER TABLE quality_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_results
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_results TO service_role;

-- Resolves applicable quality_plans for a transaction, via the matching
-- quality_rules row(s) (most specific match wins: item > category >
-- supplier > warehouse > transaction-type-only > global). Read-only,
-- called by GoodsReceiptsService/ProductionOrdersService/CountsService at
-- posting/completion time (application layer decides what to do with the
-- result — this function only resolves configuration, it never creates
-- an inspection itself).
CREATE OR REPLACE FUNCTION fn_resolve_quality_plan(
  p_tenant_id        UUID,
  p_transaction_type TEXT,
  p_item_id          UUID,
  p_category_id      UUID,
  p_supplier_id      UUID,
  p_warehouse_id     UUID
) RETURNS TABLE (rule_id UUID, plan_id UUID, template_id UUID, action TEXT, sample_size_percent NUMERIC, acceptance_defect_count INTEGER) AS $$
  SELECT qr.id, qp.id, qr.template_id, qr.action, COALESCE(qr.sample_size_percent, qp.sample_size_percent), COALESCE(qr.acceptance_defect_count, qp.acceptance_defect_count)
  FROM quality_rules qr
  LEFT JOIN quality_plans qp ON qp.template_id = qr.template_id AND qp.tenant_id = qr.tenant_id AND qp.is_active = true
  WHERE qr.tenant_id = p_tenant_id
    AND qr.is_active = true
    AND (qr.transaction_type IS NULL OR qr.transaction_type = p_transaction_type)
    AND (qr.applies_to_item_id IS NULL OR qr.applies_to_item_id = p_item_id)
    AND (qr.applies_to_category_id IS NULL OR qr.applies_to_category_id = p_category_id)
    AND (qr.applies_to_supplier_id IS NULL OR qr.applies_to_supplier_id = p_supplier_id)
    AND (qr.applies_to_warehouse_id IS NULL OR qr.applies_to_warehouse_id = p_warehouse_id)
  ORDER BY
    (qr.applies_to_item_id IS NOT NULL) DESC,
    (qr.applies_to_category_id IS NOT NULL) DESC,
    (qr.applies_to_supplier_id IS NOT NULL) DESC,
    (qr.applies_to_warehouse_id IS NOT NULL) DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;
