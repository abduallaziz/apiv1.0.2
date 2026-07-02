-- =============================================================================
-- 035 — PERFORMANCE INDEXES
-- Adds missing composite indexes on high-traffic tenant-scoped tables.
-- All indexes use IF NOT EXISTS to be idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- INVOICES
-- Existing: idx_invoices_tenant (tenant_id) WHERE deleted_at IS NULL
--           idx_invoices_status (status)  ← single-column, not tenant-scoped
-- New: tenant + date for sorted listing; tenant + status for filtered counts
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created
  ON invoices(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status
  ON invoices(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- ITEMS (products)
-- Existing: idx_items_tenant (tenant_id) WHERE deleted_at IS NULL
-- New: tenant + date for catalogue listing; tenant + active flag for filtering
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_items_tenant_created
  ON items(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_tenant_active
  ON items(tenant_id, is_active)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- PURCHASE ORDERS
-- Existing: idx_po_tenant_status (tenant_id, status) WHERE deleted_at IS NULL
-- New: tenant + date for time-sorted listing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_po_tenant_created
  ON purchase_orders(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- STOCK ADJUSTMENTS
-- Existing: idx_adjustments_tenant_status (tenant_id, status)
-- New: tenant + date for audit/history queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_adjustments_tenant_created
  ON stock_adjustments(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- STOCK TRANSFERS
-- Existing: idx_transfers_tenant_status (tenant_id, status)
-- New: tenant + date for history queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transfers_tenant_created
  ON stock_transfers(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- STOCK COUNTS
-- Existing: idx_counts_tenant_status (tenant_id, status)
-- New: tenant + date for history queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_counts_tenant_created
  ON stock_counts(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- EXPENSES
-- Existing: idx_expenses_tenant (tenant_id) WHERE deleted_at IS NULL
--           idx_expenses_status (status)  ← single-column, not tenant-scoped
-- New: tenant + date for listing; tenant + status for dashboard counts
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_created
  ON expenses(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status
  ON expenses(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- CUSTOMERS
-- Existing: idx_customers_tenant (tenant_id) WHERE deleted_at IS NULL
--           idx_customers_phone  (tenant_id, phone)
-- New: tenant + date for sorted listing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_tenant_created
  ON customers(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
