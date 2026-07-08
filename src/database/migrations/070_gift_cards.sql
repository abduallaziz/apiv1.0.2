-- Phase 10G — Gift Cards. Unlike coupons (a discount rule), a gift card is
-- stored monetary value the tenant already recognizes as a liability when
-- issued — redeeming one pays down the invoice total directly rather than
-- reducing it like a discount.

CREATE TABLE gift_cards (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT        NOT NULL,
  initial_balance NUMERIC     NOT NULL CHECK (initial_balance > 0),
  current_balance NUMERIC     NOT NULL CHECK (current_balance >= 0),
  customer_id     UUID        REFERENCES customers(id) ON DELETE SET NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_gift_cards_tenant_code_unique
  ON gift_cards (tenant_id, UPPER(code)) WHERE deleted_at IS NULL;
CREATE INDEX idx_gift_cards_tenant_active ON gift_cards (tenant_id, is_active) WHERE deleted_at IS NULL;

-- Records what an order actually paid via gift card. Plain columns, not a
-- FK — same rationale as coupons.orders.coupon_code (migration 068): the
-- gift card's own row can change balance/status later, the order's paid
-- history must not move retroactively.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_amount NUMERIC;

-- Atomic guarded decrement — same fn_adjust_loyalty_points / fn_redeem_coupon
-- pattern (migrations 041, 068): a single UPDATE...WHERE current_balance >=
-- p_amount RETURNING statement, race-safe under concurrent redemption
-- attempts of the same code, which a SELECT-then-UPDATE from the service
-- layer would not be.
CREATE OR REPLACE FUNCTION fn_redeem_gift_card(
  p_gift_card_id UUID,
  p_amount NUMERIC
)
RETURNS TABLE (current_balance NUMERIC) AS $$
  UPDATE gift_cards
     SET current_balance = current_balance - p_amount,
         updated_at = now()
   WHERE id = p_gift_card_id
     AND is_active = true
     AND deleted_at IS NULL
     AND current_balance >= p_amount
  RETURNING gift_cards.current_balance;
$$ LANGUAGE sql;

INSERT INTO permissions (name, resource, action, description, group_id)
VALUES (
  'gift_cards.manage', 'gift_cards', 'manage', 'Issue and manage gift cards',
  (SELECT id FROM permission_groups WHERE code = 'sales')
)
ON CONFLICT (name) DO UPDATE SET group_id = EXCLUDED.group_id;

GRANT ALL PRIVILEGES ON public.gift_cards TO service_role;
