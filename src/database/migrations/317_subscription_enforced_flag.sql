-- 317_subscription_enforced_flag.sql  (Per-tenant rollout switch for subscription enforcement)
-- The subscription lock (402 / countdown) is enforced when EITHER SUBSCRIPTION_ENFORCEMENT (env) names the
-- tenant OR this column is true. A column lets a super admin turn it on per tenant without a redeploy.
-- ADDITIVE and idempotent. Default false => nothing changes for any tenant until explicitly switched on.
-- ROLLBACK: ALTER TABLE tenants DROP COLUMN subscription_enforced;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_enforced BOOLEAN NOT NULL DEFAULT false;
