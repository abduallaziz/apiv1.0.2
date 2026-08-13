-- 191 — price_override_audit (D01-M3, approved 2026-08-13)
-- "Approved – Proceed with D01-M3." Scope, exactly as designed across the
-- full D01-M3 design review series: the immutable governance/audit ledger
-- table for Price Override decisions, its NOT NULL/ON DELETE strategy
-- (RESTRICT for the 5 entities never hard-deleted in this codebase, SET
-- NULL only for actor_role_id — the one FK that IS actually hard-deletable
-- via deleteRole() — paired with a permanent actor_role_name_snapshot),
-- a cross-tenant integrity trigger (order_items has no tenant_id column
-- of its own, so tenant consistency for order_item_id is proven
-- transitively via its own order_id matching NEW.order_id, which is
-- itself checked directly), an append-only immutability trigger pair
-- (same pattern as fn_block_stock_movements_mutation), 5 indexes, and RLS
-- matching M181-M184's tenant_session_isolation pattern exactly.
--
-- Does NOT compute difference_amount/difference_percent/direction, does
-- NOT implement Price Override logic, Effective Role resolution, Policy
-- Resolution, or any transaction orchestration — this migration stores
-- values the application will compute later (D01-M6/M7). Does NOT touch
-- order_items, InvoicesService, price_override_policies, any permission,
-- or any UI.

CREATE TABLE price_override_audit (
  id                          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  branch_id                   UUID          NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  order_id                    UUID          NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id                UUID          NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,

  actor_id                    UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role_id                 UUID          REFERENCES roles(id) ON DELETE SET NULL,
  actor_role_name_snapshot      TEXT          NOT NULL,

  item_id                     UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,

  official_unit_price          NUMERIC(10,2) NOT NULL,
  approved_unit_price          NUMERIC(10,2) NOT NULL,
  difference_amount            NUMERIC(10,2) NOT NULL,
  difference_percent           NUMERIC(6,2)  NOT NULL,
  direction                   TEXT          NOT NULL CHECK (direction IN ('discount', 'increase')),

  reason                      TEXT,

  effective_policy_snapshot    JSONB         NOT NULL,

  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_price_override_audit_order_item UNIQUE (order_item_id)
);

CREATE INDEX idx_price_override_audit_tenant_created ON price_override_audit (tenant_id, created_at DESC);
CREATE INDEX idx_price_override_audit_tenant_branch   ON price_override_audit (tenant_id, branch_id, created_at DESC);
CREATE INDEX idx_price_override_audit_tenant_actor     ON price_override_audit (tenant_id, actor_id, created_at DESC);
CREATE INDEX idx_price_override_audit_tenant_item      ON price_override_audit (tenant_id, item_id, created_at DESC);
CREATE INDEX idx_price_override_audit_order            ON price_override_audit (order_id);

ALTER TABLE price_override_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON price_override_audit
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.price_override_audit TO service_role;

-- ============================================================
-- Cross-tenant integrity guard — order_items has no tenant_id column of
-- its own (confirmed by direct schema read), so tenant consistency for
-- order_item_id cannot be expressed via any FK (composite or otherwise);
-- it is proven here transitively: order_items.order_id must equal
-- NEW.order_id, and NEW.order_id is itself checked directly against
-- NEW.tenant_id in the same function.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_guard_price_override_audit_integrity() RETURNS TRIGGER AS $$
DECLARE
  v_branch_tenant       UUID;
  v_order_tenant        UUID;
  v_order_item_order_id  UUID;
  v_actor_tenant        UUID;
  v_item_tenant         UUID;
  v_role_tenant_id       UUID;
BEGIN
  SELECT tenant_id INTO v_branch_tenant FROM branches WHERE id = NEW.branch_id;
  IF v_branch_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'branch_id % does not belong to tenant %', NEW.branch_id, NEW.tenant_id;
  END IF;

  SELECT tenant_id INTO v_order_tenant FROM orders WHERE id = NEW.order_id;
  IF v_order_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'order_id % does not belong to tenant %', NEW.order_id, NEW.tenant_id;
  END IF;

  SELECT order_id INTO v_order_item_order_id FROM order_items WHERE id = NEW.order_item_id;
  IF v_order_item_order_id IS DISTINCT FROM NEW.order_id THEN
    RAISE EXCEPTION 'order_item_id % does not belong to order %', NEW.order_item_id, NEW.order_id;
  END IF;

  SELECT tenant_id INTO v_actor_tenant FROM users WHERE id = NEW.actor_id;
  IF v_actor_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'actor_id % does not belong to tenant %', NEW.actor_id, NEW.tenant_id;
  END IF;

  SELECT tenant_id INTO v_item_tenant FROM items WHERE id = NEW.item_id;
  IF v_item_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'item_id % does not belong to tenant %', NEW.item_id, NEW.tenant_id;
  END IF;

  IF NEW.actor_role_id IS NOT NULL THEN
    SELECT tenant_id INTO v_role_tenant_id FROM roles WHERE id = NEW.actor_role_id;
    IF v_role_tenant_id IS NOT NULL AND v_role_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'actor_role_id % does not belong to tenant %', NEW.actor_role_id, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_override_audit_integrity_guard
BEFORE INSERT ON price_override_audit
FOR EACH ROW EXECUTE FUNCTION fn_guard_price_override_audit_integrity();

-- ============================================================
-- Immutability — append-only, same pattern as
-- fn_block_stock_movements_mutation (017_inventory_ledger.sql): a single
-- function that unconditionally raises, wired to two separate triggers
-- (BEFORE UPDATE, BEFORE DELETE) rather than one TG_OP-branching trigger,
-- matching that proven pattern exactly.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_block_price_override_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'price_override_audit is an immutable ledger — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_override_audit_no_update
  BEFORE UPDATE ON price_override_audit
  FOR EACH ROW EXECUTE FUNCTION fn_block_price_override_audit_mutation();

CREATE TRIGGER trg_price_override_audit_no_delete
  BEFORE DELETE ON price_override_audit
  FOR EACH ROW EXECUTE FUNCTION fn_block_price_override_audit_mutation();

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_price_override_audit_no_delete ON price_override_audit;
-- DROP TRIGGER IF EXISTS trg_price_override_audit_no_update ON price_override_audit;
-- DROP FUNCTION IF EXISTS fn_block_price_override_audit_mutation();
-- DROP TRIGGER IF EXISTS trg_price_override_audit_integrity_guard ON price_override_audit;
-- DROP FUNCTION IF EXISTS fn_guard_price_override_audit_integrity();
-- DROP TABLE IF EXISTS price_override_audit;
