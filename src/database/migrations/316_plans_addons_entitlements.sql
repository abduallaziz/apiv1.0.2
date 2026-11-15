-- 316_plans_addons_entitlements.sql  (Plans / add-ons / entitlements — approved design 2026-11-15)
-- Plan = base (price, users, branches, included features) + purchasable / granted add-ons.
-- ADDITIVE and idempotent. Existing plans, subscriptions and feature flags keep working unchanged.
-- ROLLBACK: DROP TABLE subscription_events, subscription_addons, plan_addon_rules, addons;
--           then drop the added columns (plans/features/subscriptions) listed below.

-- ── plans: presentation + visibility ─────────────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS name_ar        TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_public      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

-- ── features: optional stand-alone price (a feature may be bought outside the plan) ──────────
ALTER TABLE features ADD COLUMN IF NOT EXISTS price_monthly         NUMERIC(12,2);
ALTER TABLE features ADD COLUMN IF NOT EXISTS price_yearly          NUMERIC(12,2);
ALTER TABLE features ADD COLUMN IF NOT EXISTS is_addon_purchasable  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE features ADD COLUMN IF NOT EXISTS sort_order            INTEGER NOT NULL DEFAULT 0;

-- ── subscriptions: scheduled plan change, lock marker, notification de-dup ───────────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_plan_id        UUID REFERENCES plans(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_billing_cycle  TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_effective_at   TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS locked_at              TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_notified       JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── addons: catalog of what can be bought on top of a plan ───────────────────────────────────
-- type: extra_user | extra_branch | feature (feature_key set only for 'feature').
CREATE TABLE IF NOT EXISTS addons (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT        NOT NULL UNIQUE,
  type             TEXT        NOT NULL CHECK (type IN ('extra_user', 'extra_branch', 'feature')),
  feature_key      TEXT        REFERENCES features(key),
  name_ar          TEXT        NOT NULL,
  name_en          TEXT        NOT NULL,
  description      TEXT,
  price_monthly    NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_yearly     NUMERIC(12,2) NOT NULL DEFAULT 0,
  setup_wizard_key TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT addons_feature_key_chk CHECK ((type = 'feature') = (feature_key IS NOT NULL))
);

-- ── plan_addon_rules: which add-ons a plan may buy, and the maximum quantity ─────────────────
CREATE TABLE IF NOT EXISTS plan_addon_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID        NOT NULL REFERENCES plans(id),
  addon_id     UUID        NOT NULL REFERENCES addons(id),
  max_quantity INTEGER     NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_addon_rules ON plan_addon_rules (plan_id, addon_id) WHERE deleted_at IS NULL;

-- ── subscription_addons: what a tenant bought (or was granted free) ──────────────────────────
-- source 'granted' = free grant by a super admin: it always ends with the current period and is never renewed.
CREATE TABLE IF NOT EXISTS subscription_addons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  subscription_id UUID        NOT NULL REFERENCES subscriptions(id),
  addon_id        UUID        NOT NULL REFERENCES addons(id),
  quantity        INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  source          TEXT        NOT NULL DEFAULT 'purchased' CHECK (source IN ('purchased', 'granted')),
  status          TEXT        NOT NULL DEFAULT 'purchased'
                    CHECK (status IN ('purchased', 'installing', 'active', 'expired', 'cancelled')),
  billing_cycle   TEXT        CHECK (billing_cycle IN ('monthly', 'yearly')),
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchased_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ,
  installed_at    TIMESTAMPTZ,
  install_state   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  invoice_id      UUID,
  granted_by      UUID,
  grant_note      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subscription_addons_tenant ON subscription_addons (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_addons_sub    ON subscription_addons (subscription_id)    WHERE deleted_at IS NULL;

-- ── subscription_events: audit trail of every state change / purchase / grant ───────────────
CREATE TABLE IF NOT EXISTS subscription_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  subscription_id UUID        REFERENCES subscriptions(id),
  event_type      TEXT        NOT NULL,
  from_state      TEXT,
  to_state        TEXT,
  actor_id        UUID,
  details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_tenant ON subscription_events (tenant_id, created_at DESC);

-- ── Seed: the two count add-ons + one add-on per existing feature (prices set by the super admin later) ──
INSERT INTO addons (key, type, name_ar, name_en, sort_order) VALUES
  ('extra_user',   'extra_user',   'مستخدم إضافي', 'Extra user',   1),
  ('extra_branch', 'extra_branch', 'فرع إضافي',    'Extra branch', 2)
ON CONFLICT (key) DO NOTHING;

INSERT INTO addons (key, type, feature_key, name_ar, name_en, sort_order)
SELECT 'feature_' || f.key, 'feature', f.key, COALESCE(f.name_ar, f.name), f.name, 10 + f.sort_order
FROM features f
ON CONFLICT (key) DO NOTHING;

-- ── Permissions: service_role only, never the public API roles ──────────────────────────────
ALTER TABLE addons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_addon_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_addons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.addons              FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.plan_addon_rules    FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.subscription_addons FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.subscription_events FROM anon, authenticated, PUBLIC;
GRANT ALL PRIVILEGES ON public.addons              TO service_role;
GRANT ALL PRIVILEGES ON public.plan_addon_rules    TO service_role;
GRANT ALL PRIVILEGES ON public.subscription_addons TO service_role;
GRANT ALL PRIVILEGES ON public.subscription_events TO service_role;
