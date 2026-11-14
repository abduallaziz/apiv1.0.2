-- 288_customers_page_by_spend_branch.sql  (Branch isolation TASK 2)
-- fn_customers_page_by_spend gains an optional p_branch_id (NULL = tenant-wide, today's behaviour).
-- Postgres overload gotcha: the old 7-arg signature is DROPPED first so PostgREST never sees two overloads.
-- ROLLBACK: drop the 8-arg signature, then re-run migration 236's CREATE FUNCTION.
DROP FUNCTION IF EXISTS fn_customers_page_by_spend(UUID, TEXT, TEXT[], UUID[], BOOLEAN, INT, INT);

CREATE OR REPLACE FUNCTION fn_customers_page_by_spend(
  p_tenant_id UUID,
  p_search TEXT DEFAULT NULL,
  p_custom_field_keys TEXT[] DEFAULT '{}',
  p_restrict_ids UUID[] DEFAULT NULL,
  p_ascending BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  plate_number TEXT,
  visit_date DATE,
  odometer INTEGER,
  loyalty_points INTEGER,
  is_active BOOLEAN,
  custom_fields JSONB,
  created_at TIMESTAMPTZ,
  total_spent NUMERIC,
  orders_count BIGINT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT c.*
    FROM customers c
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      AND (p_restrict_ids IS NULL OR c.id = ANY(p_restrict_ids))
      AND (
        p_search IS NULL OR p_search = '' OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone ILIKE '%' || p_search || '%' OR
        EXISTS (
          SELECT 1 FROM jsonb_each_text(c.custom_fields) kv
          WHERE kv.key = ANY(p_custom_field_keys)
            AND kv.value ILIKE '%' || p_search || '%'
        )
      )
  ),
  agg AS (
    SELECT
      f.*,
      COALESCE(o.total_spent, 0) AS agg_total_spent,
      COALESCE(o.orders_count, 0) AS agg_orders_count
    FROM filtered f
    LEFT JOIN (
      SELECT customer_id, SUM(total) AS total_spent, COUNT(*) AS orders_count
      FROM orders
      WHERE tenant_id = p_tenant_id AND status = 'completed'
      GROUP BY customer_id
    ) o ON o.customer_id = f.id
  )
  SELECT
    a.id, a.full_name, a.phone, a.email, a.plate_number, a.visit_date,
    a.odometer, a.loyalty_points, a.is_active, a.custom_fields, a.created_at,
    a.agg_total_spent AS total_spent,
    a.agg_orders_count AS orders_count,
    COUNT(*) OVER () AS total_count
  FROM agg a
  ORDER BY
    CASE WHEN p_ascending THEN a.agg_total_spent END ASC NULLS LAST,
    CASE WHEN NOT p_ascending THEN a.agg_total_spent END DESC NULLS LAST,
    a.id ASC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION fn_customers_page_by_spend(UUID, TEXT, TEXT[], UUID[], BOOLEAN, INT, INT, UUID) TO authenticated, service_role;
