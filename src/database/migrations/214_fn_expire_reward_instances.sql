-- Customer Domain Batch 3 Phase 10 (Owner-approved) — daily reward
-- expiration. Single guarded UPDATE, uses the partial index created in 211
-- (idx_customer_reward_instances_expiration ON (status, expires_at) WHERE
-- status = 'unlocked') so the scan never touches redeemed/expired/eligible
-- rows. Idempotent by construction: re-running finds nothing left to
-- transition once a row is already 'expired'.
CREATE OR REPLACE FUNCTION fn_expire_reward_instances()
RETURNS TABLE (id UUID) AS $$
  UPDATE customer_reward_instances
     SET status = 'expired'
   WHERE status = 'unlocked'
     AND expires_at IS NOT NULL
     AND expires_at <= now()
  RETURNING customer_reward_instances.id;
$$ LANGUAGE sql;

GRANT EXECUTE ON FUNCTION fn_expire_reward_instances() TO service_role;
