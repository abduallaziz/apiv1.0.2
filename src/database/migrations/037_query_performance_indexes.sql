-- =============================================================================
-- 037 — QUERY PERFORMANCE INDEXES
-- Adds indexes for patterns identified during query performance audit.
-- All created CONCURRENTLY to avoid table locks on live data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ORDERS — composite for customer stats fetch in CustomersRepository.findAll
-- Query: .eq('tenant_id').eq('status','completed').in('customer_id', ids)
-- Existing: idx_orders_customer (customer_id) — forces seq scan on status+tenant
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_status_customer
  ON orders(tenant_id, status, customer_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- ORDERS — composite for invoice listing with branch + date filter
-- Query: .eq('tenant_id').eq('branch_id').gte('created_at').order('created_at DESC')
-- Existing: idx_orders_date (tenant_id, created_at DESC) — doesn't cover branch_id
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_branch_created
  ON orders(tenant_id, branch_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- ORDER_ITEMS — index on item_id for top-items report aggregation
-- Query (reports.service.ts getTopItems): join order_items to orders, group by item_id
-- Existing: idx_order_items_order (order_id) only
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_item
  ON order_items(item_id);

-- ---------------------------------------------------------------------------
-- CUSTOMERS — trigram index for ilike search on full_name and phone
-- Query: .or('full_name.ilike.%X%,phone.ilike.%X%')
-- Leading wildcard patterns cannot use B-tree; requires pg_trgm GIN index.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_fullname_trgm
  ON customers USING GIN (full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING GIN (phone gin_trgm_ops)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- DEVICE_SESSIONS — for getSessions query by user_id + FK join
-- Existing: idx_sessions_user (user_id) WHERE is_revoked = false
-- New: without the partial predicate to cover revoked sessions shown in list
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_all
  ON device_sessions(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- REFRESH_TOKENS — for logout: .eq('session_id').eq('is_used', false)
-- Existing: idx_tokens_session (session_id), idx_tokens_hash (token_hash)
-- New: composite for the revocation-by-session update path
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_session_used
  ON refresh_tokens(session_id, is_used)
  WHERE is_used = false;

-- ---------------------------------------------------------------------------
-- STOCK_LEVELS — for findLevels filtered queries
-- Query: .eq('tenant_id').eq('warehouse_id').eq('item_id')
-- No index on stock_levels beyond PK was present in initial schema.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_levels_tenant_warehouse
  ON stock_levels(tenant_id, warehouse_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_levels_tenant_item
  ON stock_levels(tenant_id, item_id);

-- ---------------------------------------------------------------------------
-- STOCK_MOVEMENTS — for findMovements filtered queries
-- Query: .eq('tenant_id').eq('warehouse_id').eq('item_id').order('occurred_at DESC')
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_tenant_occurred
  ON stock_movements(tenant_id, occurred_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_tenant_warehouse_occurred
  ON stock_movements(tenant_id, warehouse_id, occurred_at DESC);
