-- Inventory/Customers gap fix (Owner-approved) — tenant-wide loyalty points
-- total. customers.loyalty_points is the sole authoritative balance column
-- (mutated exclusively via fn_adjust_loyalty_points, migrations 041/069/
-- 209/210) — this function only SUMs it, it never introduces a second
-- balance source or touches mutation logic. Same DB-side aggregate-RPC
-- convention as customer_order_aggregates (migration 038): the SUM happens
-- in Postgres, not by fetching every customer row to the API layer.
CREATE OR REPLACE FUNCTION fn_customer_loyalty_points_total(
  p_tenant_id UUID
)
RETURNS TABLE (total_loyalty_points BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(loyalty_points), 0) AS total_loyalty_points
  FROM customers
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION fn_customer_loyalty_points_total(UUID) TO authenticated, service_role;
