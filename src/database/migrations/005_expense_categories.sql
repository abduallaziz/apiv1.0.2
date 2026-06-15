-- Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant ON expense_categories(tenant_id);

-- Add new columns to expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id),
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'one_time' CHECK (type IN ('one_time', 'recurring')),
  ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'yearly'));

-- RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_expense_categories" ON expense_categories;

CREATE POLICY "tenant_isolation_expense_categories"
  ON expense_categories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);