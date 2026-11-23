-- ROLLBACK ORDER (strict reverse of the apply order; never skip or reorder): 335, 333, 332, 330, 328, 327, 326, 325.
-- (329 and 331 are read-only / scratch-only and independent; roll 329 back only after 335.) Rolling back an earlier step while a later one is applied is NOT supported.
-- ROLLBACK for 331_schema_drift_baseline.sql
--
-- *** SCRATCH / FRESH DATABASES ONLY. NEVER RUN THIS ON PRODUCTION. ***
-- On production 331 is a no-op (every object already existed), so there is nothing to roll back there,
-- and this script would DROP real columns that hold production data (tenants.tax_rate, ...).
-- Tested on a throw-away database: after ROLLBACK the introspected schema equals the pre-331 schema.

ALTER TABLE account_roles               DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_owner_types      DISABLE ROW LEVEL SECURITY;
ALTER TABLE backorders                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_event_source_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE item_variant_sku_sequences  DISABLE ROW LEVEL SECURITY;
ALTER TABLE permission_groups           DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_barcode_sequences    DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sku_sequences        DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                  DISABLE ROW LEVEL SECURITY;

-- policy back to USING-only: a policy's WITH CHECK cannot be removed in place, so re-create it
DROP POLICY IF EXISTS tenant_isolation_expense_categories ON expense_categories;
CREATE POLICY tenant_isolation_expense_categories ON expense_categories
  USING (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid);

ALTER TABLE features DROP CONSTRAINT IF EXISTS features_category_check;
ALTER TABLE features ALTER COLUMN category DROP NOT NULL;
ALTER TABLE features ALTER COLUMN category DROP DEFAULT;
ALTER TABLE features ALTER COLUMN category TYPE TEXT;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text]));

ALTER TABLE expense_templates DROP CONSTRAINT IF EXISTS expense_templates_recurrence_type_check;
ALTER TABLE expense_templates
  DROP COLUMN IF EXISTS recurrence_type,
  DROP COLUMN IF EXISTS recurrence_day,
  DROP COLUMN IF EXISTS next_run_at,
  DROP COLUMN IF EXISTS is_pre_approved;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS currency_code,
  DROP COLUMN IF EXISTS currency_symbol,
  DROP COLUMN IF EXISTS tax_rate;
