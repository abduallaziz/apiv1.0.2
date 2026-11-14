-- 300_branch_isolation_expense_lookups.sql  (Branch isolation P5 / Task 5a — docs/DESIGN_BRANCH_ISOLATION.md D4, D5)
-- Expense lookup tables become branch-owned (one row per branch). ADDITIVE and idempotent.
-- Flag-off behaviour is unchanged: the application only filters/stamps branch_id when tenants.branch_isolation_enabled.
--   * expense_categories, expense_categories_v2, expense_departments, expense_quick_definitions, expense_templates:
--     new nullable branch_id (NULL = legacy, tenant-wide; assigned to the MAIN branch by fn_branch_isolation_backfill).
--   * Tenant-wide UNIQUE (tenant_id, name) on departments / categories_v2 is replaced by a per-branch unique index.
--     The new index is created FIRST (COALESCE(branch_id, nil uuid) keeps today's uniqueness for NULL-branch rows)
--     and only then is the old constraint dropped.
-- ROLLBACK:
--   ALTER TABLE expense_departments ADD CONSTRAINT uq_expense_departments_tenant_name UNIQUE (tenant_id, name);
--   ALTER TABLE expense_categories_v2 ADD CONSTRAINT uq_expense_categories_v2_tenant_name UNIQUE (tenant_id, name);
--   DROP INDEX IF EXISTS uq_expense_departments_tenant_branch_name, uq_expense_categories_v2_tenant_branch_name;
--   DELETE FROM branch_isolation_tables WHERE table_name IN (...this file's tables...);
--   (branch_id columns/indexes may stay; unused when the flag is off.)
-- NOTE: ADD CONSTRAINT rollback fails if per-branch duplicate names were created meanwhile: rename them first.

ALTER TABLE expense_categories        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE expense_categories_v2     ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE expense_departments       ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE expense_quick_definitions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE expense_templates         ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant_branch
  ON expense_categories (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_v2_tenant_branch_active
  ON expense_categories_v2 (tenant_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_expense_departments_tenant_branch_active
  ON expense_departments (tenant_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_expense_quick_definitions_tenant_branch_active_sort
  ON expense_quick_definitions (tenant_id, branch_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_expense_templates_tenant_branch
  ON expense_templates (tenant_id, branch_id);

-- Per-branch uniqueness (D5): create the new index first, then drop the tenant-wide one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_departments_tenant_branch_name
  ON expense_departments (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_v2_tenant_branch_name
  ON expense_categories_v2 (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

ALTER TABLE expense_departments    DROP CONSTRAINT IF EXISTS uq_expense_departments_tenant_name;
ALTER TABLE expense_categories_v2  DROP CONSTRAINT IF EXISTS uq_expense_categories_v2_tenant_name;

INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('expense_categories', 'legacy expense categories (lookup)'),
  ('expense_categories_v2', 'expenses v2 categories (lookup)'),
  ('expense_departments', 'expenses v2 departments (lookup)'),
  ('expense_quick_definitions', 'quick expense buttons (lookup)'),
  ('expense_templates', 'legacy expense templates (lookup)')
ON CONFLICT (table_name) DO NOTHING;
