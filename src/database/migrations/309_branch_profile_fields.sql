-- 309: branch profile fields for the branch setup wizard (informational / stored-only).
-- Additive and idempotent. ROLLBACK (manual, only if needed):
--   DROP INDEX IF EXISTS uq_branches_tenant_short_code;
--   ALTER TABLE branches DROP COLUMN IF EXISTS short_code, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS phone,
--     DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS tax_number, DROP COLUMN IF EXISTS commercial_registration,
--     DROP COLUMN IF EXISTS invoice_footer, DROP COLUMN IF EXISTS printer_size, DROP COLUMN IF EXISTS working_hours;
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS short_code TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS tax_number TEXT,
  ADD COLUMN IF NOT EXISTS commercial_registration TEXT,
  ADD COLUMN IF NOT EXISTS invoice_footer TEXT,
  ADD COLUMN IF NOT EXISTS printer_size TEXT,
  ADD COLUMN IF NOT EXISTS working_hours JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_tenant_short_code
  ON branches (tenant_id, upper(short_code))
  WHERE short_code IS NOT NULL AND deleted_at IS NULL;
