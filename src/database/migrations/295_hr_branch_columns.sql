-- 295_hr_branch_columns.sql  (Branch isolation P4 / TASK 4 - HR; docs/DESIGN_BRANCH_ISOLATION.md D4, D7)
-- Adds branch ownership to the HR tables that had none. ADDITIVE and idempotent; behaviour changes only
-- for tenants that turn branch isolation on (application code is flag-gated).
-- attendance_records / work_schedules / users already carry branch_id (nullable).
-- ROLLBACK (safe, nothing else depends on the columns):
--   ALTER TABLE departments DROP COLUMN IF EXISTS branch_id; ALTER TABLE shift_patterns DROP COLUMN IF EXISTS branch_id;
--   ALTER TABLE employee_geofences DROP COLUMN IF EXISTS branch_id; ALTER TABLE attendance_exceptions DROP COLUMN IF EXISTS branch_id;

ALTER TABLE departments           ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE shift_patterns        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE employee_geofences    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE attendance_exceptions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_departments_tenant_branch           ON departments (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_shift_patterns_tenant_branch        ON shift_patterns (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_employee_geofences_tenant_branch    ON employee_geofences (tenant_id, branch_id, user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_tenant_branch ON attendance_exceptions (tenant_id, branch_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_branch    ON attendance_records (tenant_id, branch_id, check_in_at);
CREATE INDEX IF NOT EXISTS idx_work_schedules_tenant_branch        ON work_schedules (tenant_id, branch_id);

-- Per-employee rows follow the employee's branch when the employee already has one (no-op otherwise;
-- rows of unbranched employees are assigned when isolation is enabled).
UPDATE employee_geofences g SET branch_id = u.branch_id
  FROM users u WHERE g.user_id = u.id AND g.branch_id IS NULL AND u.branch_id IS NOT NULL;
UPDATE attendance_exceptions e SET branch_id = u.branch_id
  FROM users u WHERE e.user_id = u.id AND e.branch_id IS NULL AND u.branch_id IS NOT NULL;

INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('departments', 'HR departments (D4)'),
  ('shift_patterns', 'HR shift patterns (D4)'),
  ('employee_geofences', 'HR per-employee geofences'),
  ('attendance_exceptions', 'HR excused absences')
ON CONFLICT (table_name) DO NOTHING;
