-- Phase 10G — Coupons. `coupons` table never existed at all (only a generic
-- DiscountEngine for manual owner-entered discounts) — this adds real
-- reusable discount codes a customer can redeem at checkout, reusing
-- DiscountEngine's percentage/fixed math instead of duplicating it.

CREATE TABLE coupons (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                TEXT        NOT NULL,
  discount_type       TEXT        NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value      NUMERIC     NOT NULL CHECK (discount_value > 0),
  max_discount_amount NUMERIC     CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  min_order_amount    NUMERIC     CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  max_uses            INTEGER     CHECK (max_uses IS NULL OR max_uses > 0),
  used_count          INTEGER     NOT NULL DEFAULT 0,
  valid_from          TIMESTAMPTZ,
  valid_to            TIMESTAMPTZ,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Case-insensitive uniqueness per tenant among non-deleted coupons — codes
-- are typically typed by a cashier/customer, forcing exact case would be
-- a UX trap.
CREATE UNIQUE INDEX idx_coupons_tenant_code_unique
  ON coupons (tenant_id, UPPER(code)) WHERE deleted_at IS NULL;

CREATE INDEX idx_coupons_tenant_active ON coupons (tenant_id, is_active) WHERE deleted_at IS NULL;

-- Records which coupon (if any) an order used. Plain text, not a FK — a
-- coupon can be edited/deleted later and the order's history must not
-- change retroactively. Same rationale as payment_method being a plain enum
-- column rather than a joined reference.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- Atomic guarded increment — mirrors fn_adjust_loyalty_points (migration 041)
-- exactly, for the same reason: a plain SELECT-then-UPDATE from the service
-- layer has a TOCTOU race under concurrent checkouts on the same code, and
-- the Supabase JS client cannot express a column-vs-column comparison
-- (used_count < max_uses) in a single filtered .update() call anyway.
CREATE OR REPLACE FUNCTION fn_redeem_coupon(
  p_coupon_id UUID
)
RETURNS TABLE (used_count INTEGER) AS $$
  UPDATE coupons
     SET used_count = used_count + 1,
         updated_at = now()
   WHERE id = p_coupon_id
     AND is_active = true
     AND deleted_at IS NULL
     AND (max_uses IS NULL OR used_count < max_uses)
  RETURNING coupons.used_count;
$$ LANGUAGE sql;

-- New permission, inserted directly (not left to the next seed:permissions
-- run) so group_id is correct immediately — seedPermissions() only upserts
-- name/resource/action/description, never group_id, so relying on the seed
-- to create this row first and a later migration to backfill group_id would
-- leave it NULL until someone remembers to re-run the backfill by hand.
INSERT INTO permissions (name, resource, action, description, group_id)
VALUES (
  'coupons.manage', 'coupons', 'manage', 'Create and manage discount coupons',
  (SELECT id FROM permission_groups WHERE code = 'sales')
)
ON CONFLICT (name) DO UPDATE SET group_id = EXCLUDED.group_id;

-- GRANT in the same migration file that creates the table — required since
-- §48/§68/§71 (three separate production incidents, all the same root cause:
-- a new table with no explicit service_role grant).
GRANT ALL PRIVILEGES ON public.coupons TO service_role;
