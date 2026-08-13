-- Migration 13.17 Phase B — MRP Engine, part 1: planned_orders table.
--
-- Design decision (per api/CLAUDE.md architectural approval protocol,
-- reviewed and approved before implementation):
--
--   MRP never writes a real purchase_order/production_order directly.
--   Every output of fn_run_mrp (migration 161) is a row here, requiring an
--   explicit user "approve" then "convert" action — same
--   approval-before-action principle as Phase A's suggestion-to-Purchase-
--   Request flow, extended to production. Conversion calls the EXISTING
--   PurchaseRequestsService.create() / ProductionOrdersService.create()
--   unmodified — no duplicated business logic.
--
--   order_type is determined by whether the item has an ACTIVE BOM, not by
--   items.type (that string alone can't distinguish a bought vs. assembled
--   item of the same type) — bom_id is required for 'production' rows and
--   NULL for 'purchase' rows (CHECK enforced).

CREATE TABLE planned_orders (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id              UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id                   UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id                UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  order_type                TEXT          NOT NULL CHECK (order_type IN ('purchase', 'production')),
  bom_id                    UUID          REFERENCES bill_of_materials(id) ON DELETE RESTRICT,
  quantity                  NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  needed_by_date            DATE,
  source                    TEXT          NOT NULL CHECK (source IN ('independent_demand', 'dependent_demand')),
  parent_planned_order_id   UUID          REFERENCES planned_orders(id) ON DELETE CASCADE,
  mrp_run_id                UUID          NOT NULL,
  status                    TEXT          NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'converted', 'cancelled')),
  converted_reference_type  TEXT          CHECK (converted_reference_type IN ('purchase_request', 'production_order')),
  converted_reference_id    UUID,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT planned_orders_bom_required_for_production CHECK (
    (order_type = 'production' AND bom_id IS NOT NULL) OR
    (order_type = 'purchase' AND bom_id IS NULL)
  )
);

CREATE INDEX idx_planned_orders_tenant_warehouse_status ON planned_orders(tenant_id, warehouse_id, status);
CREATE INDEX idx_planned_orders_run ON planned_orders(tenant_id, mrp_run_id);
CREATE INDEX idx_planned_orders_parent ON planned_orders(parent_planned_order_id) WHERE parent_planned_order_id IS NOT NULL;

ALTER TABLE planned_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON planned_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.planned_orders TO service_role;
