-- 291_sales_floor_branch_indexes.sql  (Branch isolation P3)
-- Indexes for branch-scoped lists of sales, returns and the floor (additive, IF NOT EXISTS) and registration of
-- sales_returns in the isolation backfill registry (orders is registered by 280; shifts, tables, waitlist_entries
-- and wash_jobs already have NOT NULL branch_id).
-- ROLLBACK: DROP INDEX IF EXISTS idx_orders_tenant_branch_created, idx_sales_returns_tenant_branch_created,
--           idx_shifts_tenant_branch_opened; DELETE FROM branch_isolation_tables WHERE table_name = 'sales_returns';

CREATE INDEX IF NOT EXISTS idx_orders_tenant_branch_created
  ON orders (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_tenant_branch_created
  ON sales_returns (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_branch_opened
  ON shifts (tenant_id, branch_id, opened_at DESC);

INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('sales_returns', 'returns inherit the order branch (nullable branch_id)')
ON CONFLICT (table_name) DO NOTHING;
