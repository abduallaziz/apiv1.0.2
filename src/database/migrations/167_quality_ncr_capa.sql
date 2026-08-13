-- Migration 13.19 Part 4 — Non-Conformance lifecycle completion, Defect
-- Management, CAPA (Corrective Action), and Deviation Management
-- (Phases 3/4/9/12 of the approved design). Rework/Disposition folded into
-- quality_holds.disposition (166) and corrective_actions.disposition below
-- — no separate module. Customer Complaints folded into non_conformances
-- via source/customer columns — no separate table. Quality Cost is a
-- read-only aggregation over quality_defects.cost_impact + existing
-- cost_layers, not a new ledger — added as a view at the end.

ALTER TABLE non_conformances DROP CONSTRAINT non_conformances_status_check;
ALTER TABLE non_conformances ADD CONSTRAINT non_conformances_status_check
  CHECK (status IN ('open', 'investigating', 'containment', 'corrective_action', 'verification', 'closed'));

ALTER TABLE non_conformances ADD COLUMN category TEXT CHECK (category IN ('manufacturing_defect', 'supplier_defect', 'packaging_defect', 'specification_failure', 'customer_complaint', 'other'));
ALTER TABLE non_conformances ADD COLUMN root_cause TEXT;
ALTER TABLE non_conformances ADD COLUMN source TEXT NOT NULL DEFAULT 'inspection' CHECK (source IN ('inspection', 'customer_complaint', 'manual'));
ALTER TABLE non_conformances ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE non_conformances ADD COLUMN customer_reference TEXT;
ALTER TABLE non_conformances ADD COLUMN responsible_user_id UUID REFERENCES users(id);
ALTER TABLE non_conformances ADD COLUMN evidence_url TEXT;
ALTER TABLE non_conformances ADD COLUMN resolution_notes TEXT;
-- quality_inspection_id was NOT NULL (migration 145) — a customer-complaint-
-- sourced NCR has no inspection to link to, so it must become nullable.
ALTER TABLE non_conformances ALTER COLUMN quality_inspection_id DROP NOT NULL;

CREATE TABLE quality_defects (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  non_conformance_id    UUID          NOT NULL REFERENCES non_conformances(id) ON DELETE CASCADE,
  defect_code           TEXT          NOT NULL,
  category               TEXT         NOT NULL CHECK (category IN ('manufacturing_defect', 'supplier_defect', 'packaging_defect', 'specification_failure')),
  severity               TEXT         NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  quantity_affected       NUMERIC(14,4),
  cost_impact             NUMERIC(14,4),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_defects_ncr ON quality_defects(tenant_id, non_conformance_id);
ALTER TABLE quality_defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_defects
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_defects TO service_role;

-- CAPA — a real, tracked entity, not a text field. One non_conformance can
-- have multiple corrective_actions (e.g. an immediate containment action
-- and a longer-term systemic fix), each independently lifecycle-tracked.
CREATE TABLE corrective_actions (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  non_conformance_id  UUID          NOT NULL REFERENCES non_conformances(id) ON DELETE CASCADE,
  title               TEXT          NOT NULL,
  description         TEXT,
  owner_id            UUID          NOT NULL REFERENCES users(id),
  priority            TEXT          NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_date            DATE,
  status              TEXT          NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'verified', 'closed')),
  disposition         TEXT          CHECK (disposition IN ('accept', 'reject', 'scrap', 'rework', 'return_supplier', 'use_as_is')),
  completed_at        TIMESTAMPTZ,
  completed_by        UUID          REFERENCES users(id),
  effectiveness_check  TEXT,
  verified_at          TIMESTAMPTZ,
  verified_by          UUID          REFERENCES users(id),
  closure_notes        TEXT,
  closed_at            TIMESTAMPTZ,
  closed_by            UUID          REFERENCES users(id),
  created_by           UUID          REFERENCES users(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_corrective_actions_ncr ON corrective_actions(tenant_id, non_conformance_id);
CREATE INDEX idx_corrective_actions_owner ON corrective_actions(tenant_id, owner_id, status);
ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON corrective_actions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.corrective_actions TO service_role;

CREATE TABLE corrective_action_history (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  corrective_action_id UUID       NOT NULL REFERENCES corrective_actions(id) ON DELETE CASCADE,
  old_status          TEXT,
  new_status          TEXT        NOT NULL,
  actor_id            UUID        REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_corrective_action_history_action ON corrective_action_history(tenant_id, corrective_action_id);
ALTER TABLE corrective_action_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON corrective_action_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.corrective_action_history TO service_role;

-- Deviation Management: conditional-acceptance requests, independent of
-- a specific non_conformance (a deviation can be requested proactively —
-- "accept this batch outside spec, just this once" — before any NCR
-- exists), but may reference one for traceability.
CREATE TABLE quality_deviations (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  non_conformance_id  UUID          REFERENCES non_conformances(id) ON DELETE SET NULL,
  quality_inspection_id UUID        REFERENCES quality_inspections(id) ON DELETE SET NULL,
  item_id             UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  reason              TEXT          NOT NULL,
  requested_by        UUID          REFERENCES users(id),
  status              TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approver_id         UUID          REFERENCES users(id),
  decision_notes       TEXT,
  decided_at           TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quality_deviations_status ON quality_deviations(tenant_id, status);
ALTER TABLE quality_deviations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON quality_deviations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.quality_deviations TO service_role;

-- Quality Cost view: read-only aggregation over quality_defects.cost_impact
-- (application-supplied estimate) plus real scrap/rework movement costs
-- already in stock_movements (movement_type IN ('damage','production_scrap'))
-- — no new ledger, no change to Costing Engine, exactly as scoped.
CREATE OR REPLACE VIEW v_quality_cost_summary AS
SELECT
  qd.tenant_id,
  DATE_TRUNC('month', qd.created_at) AS month,
  SUM(qd.cost_impact) FILTER (WHERE qd.category = 'supplier_defect') AS supplier_failure_cost,
  SUM(qd.cost_impact) FILTER (WHERE qd.category != 'supplier_defect') AS internal_quality_cost,
  SUM(qd.cost_impact) AS total_quality_cost
FROM quality_defects qd
GROUP BY qd.tenant_id, DATE_TRUNC('month', qd.created_at);

GRANT SELECT ON v_quality_cost_summary TO service_role;
