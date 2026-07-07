-- S5 Stage C. Introduces a curated, stable classification for the permission
-- catalog so the frontend can render permission categories (Employees,
-- Attendance, Expenses, Payroll, Reports, ...) from data instead of a
-- hardcoded list. permissions.resource is left completely untouched — it's
-- an older, messier categorization (e.g. both 'expense' and 'expenses' exist
-- as separate values from different migration eras) that some existing code
-- may still rely on; group_id is a new, separate, curated classification
-- that coexists with it.
--
-- `code` is the stable, machine-readable key the frontend must switch on.
-- name_ar/name_en are display-only and can be reworded later without ever
-- breaking frontend logic tied to group identity.
CREATE TABLE IF NOT EXISTS permission_groups (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code       TEXT        NOT NULL UNIQUE,
  name_ar    TEXT        NOT NULL,
  name_en    TEXT        NOT NULL,
  sort_order INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permission_groups (code, name_ar, name_en, sort_order) VALUES
  ('employees',  'الموظفون',               'Employees',    1),
  ('attendance', 'الحضور والانصراف',        'Attendance',   2),
  ('expenses',   'المصروفات',               'Expenses',     3),
  ('payroll',    'الرواتب',                 'Payroll',      4),
  ('reports',    'التقارير',                'Reports',      5),
  ('inventory',  'المخزون',                 'Inventory',    6),
  ('purchasing', 'المشتريات',               'Purchasing',   7),
  ('sales',      'نقاط البيع والمبيعات',     'Sales & POS',  8),
  ('settings',   'الإعدادات',               'Settings',     9),
  ('platform',   'النظام',                  'Platform',     10)
ON CONFLICT (code) DO NOTHING;

-- Additive nullable column — no existing reader of `permissions` is affected
-- by its presence until code explicitly starts selecting/joining on it.
ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES permission_groups(id);

-- Explicit, one-key-at-a-time mapping — every one of the 55 keys currently
-- in the catalog is assigned by name, never inferred from `resource` or a
-- name pattern (e.g. no `WHERE name LIKE 'invoice.%'`), so this stays
-- auditable line-by-line against the reviewed/approved mapping table and
-- can't silently misclassify a similarly-named key added later.
UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'employees')
WHERE name IN ('users.view', 'users.manage');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'attendance')
WHERE name IN ('attendance.checkin', 'attendance.view.all');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'expenses')
WHERE name IN (
  'expense.request', 'expense.view.branch', 'expense.view.all',
  'expense.approve', 'expense.reject', 'expenses.view', 'expenses.manage'
);

-- TEMPORARY COMPATIBILITY MAPPING — hr.manage also covers non-payroll HR
-- operations today (schedules, shift patterns, leave approval), so grouping
-- it under "Payroll" is an approximation, not a clean domain fit. Planned
-- future catalog split (separate, later change — not part of this
-- migration): payroll.view, payroll.manage, payroll.export, payroll.approve.
-- Once those exist, hr.manage should be re-scoped to genuinely HR-only
-- actions and moved to a more accurate group, while the new payroll.* keys
-- take over the `payroll` group properly.
UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'payroll')
WHERE name IN ('hr.manage');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'reports')
WHERE name IN ('reports.view.branch', 'reports.view.all', 'analytics.view.all');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'inventory')
WHERE name IN (
  'inventory.view', 'inventory.manage', 'inventory.adjust',
  'inventory.adjust.approve', 'inventory.transfer', 'inventory.count', 'inventory.reserve'
);

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'purchasing')
WHERE name IN ('purchasing.view', 'purchasing.manage', 'purchasing.approve', 'purchasing.receive');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'sales')
WHERE name IN (
  'invoice.create.own', 'invoice.view.own', 'invoice.view.branch', 'invoice.view.all',
  'invoice.cancel.own', 'invoice.cancel.branch', 'invoice.view', 'invoice.create', 'invoice.cancel',
  'shift.open', 'shift.close', 'shift.view.own', 'shift.view.branch', 'shift.view.all',
  'customers.view', 'customers.manage', 'items.view', 'items.manage',
  'tables.manage', 'kitchen.manage'
);

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'settings')
WHERE name IN ('settings.view', 'settings.manage', 'branches.view', 'branches.manage');

UPDATE permissions SET group_id = (SELECT id FROM permission_groups WHERE code = 'platform')
WHERE name IN (
  'audit.view.all', 'superadmin.queue.view', 'superadmin.queue.manage',
  'superadmin.health.view', 'superadmin.backup.view'
);

-- ============================================================
-- VERIFICATION QUERIES (for post-deploy confirmation — not executed
-- automatically by this migration; run manually after it applies)
-- ============================================================

-- 1. Permissions without a group assignment. Expected: 0 rows.
--    Any row returned here means a permission key exists in the catalog
--    that wasn't covered by the explicit mapping above and needs its own
--    reviewed mapping decision before being left ungrouped.
-- SELECT name, resource, action FROM permissions WHERE group_id IS NULL;

-- 2. Permission groups with their permission counts, for post-deploy
--    sanity-checking the distribution matches the approved mapping table
--    (expected: employees=2, attendance=2, expenses=7, payroll=1,
--    reports=3, inventory=7, purchasing=4, sales=20, settings=4, platform=5).
-- SELECT pg.code, pg.name_en, COUNT(p.id) AS permission_count
-- FROM permission_groups pg
-- LEFT JOIN permissions p ON p.group_id = pg.id
-- GROUP BY pg.code, pg.name_en, pg.sort_order
-- ORDER BY pg.sort_order;
