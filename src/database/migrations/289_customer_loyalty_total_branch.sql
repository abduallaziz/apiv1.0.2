-- 289_customer_loyalty_total_branch.sql  (Branch isolation TASK 2 - D10: loyalty points never cross branches)
-- fn_customer_loyalty_points_total gains an optional p_branch_id (NULL = tenant-wide, today's behaviour).
-- The old 1-arg signature is DROPPED first (Postgres overload gotcha).
-- ROLLBACK: drop the 2-arg signature, then re-run migration 233.
DROP FUNCTION IF EXISTS fn_customer_loyalty_points_total(UUID);

CREATE OR REPLACE FUNCTION fn_customer_loyalty_points_total(
  p_tenant_id UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (total_loyalty_points BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(loyalty_points), 0) AS total_loyalty_points
  FROM customers
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);
$$;

GRANT EXECUTE ON FUNCTION fn_customer_loyalty_points_total(UUID, UUID) TO authenticated, service_role;
