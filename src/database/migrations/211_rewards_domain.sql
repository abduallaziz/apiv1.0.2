-- Customer Domain Batch 3 Phase 9 (Owner-approved) — Rewards domain.
-- Separate from Loyalty and Coupons per the approved architecture: a Reward
-- Definition is a repeatable rule; a Reward Instance is a one-time,
-- independently-lifecycled unlock generated from that rule. Purely
-- additive — no existing table/column touched.

CREATE TABLE reward_definitions (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  trigger_type          TEXT        NOT NULL CHECK (trigger_type IN (
                          'purchase_count', 'spend_threshold', 'product_category', 'birthday', 'campaign', 'loyalty_points'
                        )),
  -- Generic trigger parameters, shape depends on trigger_type — e.g.
  -- {"count": 5} for purchase_count, {"amount": 500} for spend_threshold,
  -- {"category_id": "...", "count": 3} for product_category. Kept as jsonb
  -- (same pattern already used for other flexible config columns in this
  -- codebase) rather than one column per trigger type, since trigger_type
  -- is itself extensible and each type's shape genuinely differs.
  trigger_config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  reward_type           TEXT        NOT NULL CHECK (reward_type IN (
                          'free_item', 'percentage_discount', 'fixed_discount', 'coupon_reference'
                        )),
  -- e.g. {"item_id": "..."} for free_item, {"percent": 10} for
  -- percentage_discount, {"amount": 20} for fixed_discount,
  -- {"coupon_id": "..."} for coupon_reference.
  reward_config         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Redemption-time conditions checked against the invoice being redeemed
  -- against (e.g. {"min_order_amount": 50}). Empty object = no conditions.
  usage_conditions       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  branch_scope          TEXT        NOT NULL DEFAULT 'all' CHECK (branch_scope IN ('all', 'specific')),
  branch_id             UUID        REFERENCES branches(id),
  -- Duration in days from unlock to expiry; NULL = never expires.
  expiration_days       INTEGER     CHECK (expiration_days IS NULL OR expiration_days > 0),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT chk_reward_definitions_branch_scope
    CHECK (branch_scope = 'all' OR branch_id IS NOT NULL)
);

CREATE INDEX idx_reward_definitions_tenant_active
  ON reward_definitions (tenant_id, is_active) WHERE deleted_at IS NULL;

CREATE TABLE customer_reward_instances (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           UUID        NOT NULL REFERENCES customers(id),
  reward_definition_id  UUID        NOT NULL REFERENCES reward_definitions(id),
  status                TEXT        NOT NULL DEFAULT 'unlocked' CHECK (status IN (
                          'eligible', 'unlocked', 'redeemed', 'expired'
                        )),
  -- Where the instance was generated vs. where it was actually spent — can
  -- differ under an 'all' branch_scope definition. Both nullable: an
  -- instance can unlock from a non-branch-scoped event (e.g. birthday/
  -- campaign trigger with no order context) and is obviously unredeemed
  -- (NULL) until redemption happens.
  unlocked_branch_id    UUID        REFERENCES branches(id),
  redeemed_branch_id    UUID        REFERENCES branches(id),
  redeemed_order_id     UUID        REFERENCES orders(id),
  -- The ordinal (1st, 2nd, 3rd... instance this rule has produced for this
  -- customer) — the idempotency/dedup key alongside reward_definition_id +
  -- customer_id, see fn_process_purchase_reward_event (212).
  instance_ordinal      INTEGER     NOT NULL,
  unlocked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at           TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defense-in-depth against duplicate instance generation (order retries,
-- concurrent event processing) — belt-and-suspenders alongside
-- reward_progress_events' own UNIQUE(tenant_id, reward_definition_id,
-- order_id) in 212. Two independent unique constraints covering the same
-- invariant from different angles.
CREATE UNIQUE INDEX idx_customer_reward_instances_ordinal_unique
  ON customer_reward_instances (tenant_id, reward_definition_id, customer_id, instance_ordinal);

CREATE INDEX idx_customer_reward_instances_customer
  ON customer_reward_instances (tenant_id, customer_id, status);

-- Phase 10's daily expiration job scans exactly this shape — unlocked
-- instances whose expiry has passed — never redeemed/expired/eligible rows.
CREATE INDEX idx_customer_reward_instances_expiration
  ON customer_reward_instances (status, expires_at) WHERE status = 'unlocked';

-- Idempotent purchase-count progress ledger. One row per (definition, order)
-- that qualified — COUNT(*) over this table for a given
-- (customer_id, reward_definition_id) IS the progress counter, and the
-- UNIQUE constraint is what makes fn_process_purchase_reward_event safe to
-- call twice for the same order (retry, duplicate request) without
-- double-counting. Purchase-count trigger evaluation therefore never scans
-- orders/order_items — only ever this small, indexed, append-only table.
CREATE TABLE reward_progress_events (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           UUID        NOT NULL REFERENCES customers(id),
  reward_definition_id  UUID        NOT NULL REFERENCES reward_definitions(id),
  order_id              UUID        NOT NULL REFERENCES orders(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_reward_progress_events_order_unique
  ON reward_progress_events (tenant_id, reward_definition_id, order_id);
CREATE INDEX idx_reward_progress_events_customer
  ON reward_progress_events (tenant_id, customer_id, reward_definition_id);

ALTER TABLE reward_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON reward_definitions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE customer_reward_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON customer_reward_instances
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE reward_progress_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON reward_progress_events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.reward_definitions TO service_role;
GRANT ALL PRIVILEGES ON public.customer_reward_instances TO service_role;
GRANT ALL PRIVILEGES ON public.reward_progress_events TO service_role;

INSERT INTO permissions (name, resource, action, description, group_id)
VALUES (
  'rewards.manage', 'rewards', 'manage', 'Create and manage reward definitions',
  (SELECT id FROM permission_groups WHERE code = 'sales')
)
ON CONFLICT (name) DO UPDATE SET group_id = EXCLUDED.group_id;
