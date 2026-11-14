-- 296_hr_branch_unique.sql  (TASK 4 - D5 per-branch uniqueness for departments and shift patterns)
-- New unique indexes use COALESCE(branch_id, nil uuid) so legacy NULL-branch rows keep today's uniqueness.
-- The old tenant-wide departments constraint is dropped only AFTER the branch-scoped index exists.
-- shift_patterns had no uniqueness before: the index is created only if no duplicate names exist today
-- (otherwise it is skipped with a NOTICE and the application enforces it on write).
-- ROLLBACK: DROP INDEX IF EXISTS uq_departments_tenant_branch_name, uq_shift_patterns_tenant_branch_name;
--           ALTER TABLE departments ADD CONSTRAINT departments_tenant_id_name_key UNIQUE (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_tenant_branch_name
  ON departments (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_tenant_id_name_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM shift_patterns
     GROUP BY tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'shift_patterns has duplicate names: per-branch unique index skipped (enforced by the application)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_patterns_tenant_branch_name
      ON shift_patterns (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
  END IF;
END $$;
