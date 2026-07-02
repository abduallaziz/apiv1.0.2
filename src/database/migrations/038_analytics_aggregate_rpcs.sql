-- RPC: sum all completed orders revenue (replaces JS-side reduce over full table)
CREATE OR REPLACE FUNCTION sum_completed_orders_revenue()
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(total), 0)
  FROM orders
  WHERE status = 'completed';
$$;

-- RPC: per-tenant usage analytics — replaces N+1 loop (5 queries × N tenants)
CREATE OR REPLACE FUNCTION get_tenant_usage_analytics(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  tenant_id      UUID,
  tenant_name    TEXT,
  invoices_count BIGINT,
  shifts_count   BIGINT,
  expenses_count BIGINT,
  users_count    BIGINT,
  last_activity  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.id                                              AS tenant_id,
    t.name                                            AS tenant_name,
    COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= p_from AND o.created_at <= p_to) AS invoices_count,
    COUNT(DISTINCT s.id) FILTER (WHERE s.opened_at  >= p_from AND s.opened_at  <= p_to) AS shifts_count,
    COUNT(DISTINCT e.id) FILTER (WHERE e.created_at >= p_from AND e.created_at <= p_to) AS expenses_count,
    COUNT(DISTINCT u.id) FILTER (WHERE u.deleted_at IS NULL)                             AS users_count,
    MAX(o.created_at)                                                                    AS last_activity
  FROM tenants t
  LEFT JOIN orders   o ON o.tenant_id = t.id
  LEFT JOIN shifts   s ON s.tenant_id = t.id
  LEFT JOIN expenses e ON e.tenant_id = t.id
  LEFT JOIN users    u ON u.tenant_id = t.id
  WHERE t.deleted_at IS NULL
    AND t.status = 'active'
  GROUP BY t.id, t.name
  ORDER BY invoices_count DESC;
$$;

-- RPC: customer order aggregates — replaces JS-side reduce in getStats()
CREATE OR REPLACE FUNCTION customer_order_aggregates(
  p_tenant_id   UUID,
  p_customer_id UUID
)
RETURNS TABLE (total_spent NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(total), 0) AS total_spent
  FROM orders
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_customer_id
    AND status = 'completed';
$$;

GRANT EXECUTE ON FUNCTION sum_completed_orders_revenue()                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_tenant_usage_analytics(TIMESTAMPTZ, TIMESTAMPTZ)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION customer_order_aggregates(UUID, UUID)                  TO authenticated, service_role;
