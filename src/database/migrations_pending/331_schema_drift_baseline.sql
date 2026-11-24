-- 331_schema_drift_baseline.sql  (PENDING - not applied by the runner; lives in migrations_pending/)
--
-- Purpose: make a database REBUILT FROM THE MIGRATIONS match the production schema snapshot
-- (pg_dump -s of schema public, taken 2026-11-23, pre-324) for the objects that production has but
-- no migration creates. Found by scripts/schema-drift.js (see the WP-C report).
--
-- Safety contract:
--   * IDEMPOTENT and a NO-OP on production: every statement either uses IF NOT EXISTS or is guarded
--     by a catalog check that is already satisfied there. Running it twice changes nothing.
--   * NO DATA: no INSERT, no row is created. The only row-touching statement is the guarded
--     backfill of features.category NULLs to 'core' (prod already has none: the column is NOT NULL there).
--   * Additive/mirroring only. It does NOT drop anything and does NOT weaken anything. Drift where the
--     MIGRATIONS are ahead of production, or where production is less protected than the migrations
--     intend (RLS disabled), is deliberately left untouched and is reported, not "fixed" (see report).
--
-- Rollback: rollback/331_schema_drift_baseline_ROLLBACK.sql  (scratch/fresh databases ONLY).

-- 1) tenants: read by the code (tax rate, currency symbol/code) but created by no migration.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS currency_code   VARCHAR(10)  DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS currency_symbol VARCHAR(10)  DEFAULT E'⃁',
  ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0.15;

-- 2) expense_templates: recurrence + pre-approval columns exist in production only.
ALTER TABLE expense_templates
  ADD COLUMN IF NOT EXISTS recurrence_type TEXT        NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_day  INTEGER,
  ADD COLUMN IF NOT EXISTS next_run_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_pre_approved BOOLEAN     NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expense_templates'::regclass
      AND conname = 'expense_templates_recurrence_type_check'
  ) THEN
    ALTER TABLE expense_templates
      ADD CONSTRAINT expense_templates_recurrence_type_check
      CHECK (recurrence_type = ANY (ARRAY['none'::text, 'daily'::text, 'weekly'::text, 'monthly'::text]));
  END IF;
END $$;

-- 3) expenses.status: production also allows 'cancelled' (migrations stop at 4 values).
--    Replace the check only when it does not yet admit 'cancelled' (no-op on production).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_status_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%cancelled%'
  ) THEN
    ALTER TABLE expenses DROP CONSTRAINT expenses_status_check;
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_status_check
      CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text]));
  END IF;
END $$;

-- 4) features.category: production is VARCHAR(20) NOT NULL DEFAULT 'core' with a value check;
--    migration 003 created it as nullable TEXT. Converge only when it is still the migration shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'features'
      AND column_name = 'category' AND data_type = 'text'
  ) THEN
    UPDATE features SET category = 'core' WHERE category IS NULL;
    ALTER TABLE features ALTER COLUMN category TYPE VARCHAR(20);
    ALTER TABLE features ALTER COLUMN category SET DEFAULT 'core';
    ALTER TABLE features ALTER COLUMN category SET NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.features'::regclass AND conname = 'features_category_check'
  ) THEN
    ALTER TABLE features
      ADD CONSTRAINT features_category_check
      CHECK ((category)::text = ANY ((ARRAY['core'::character varying, 'advanced'::character varying, 'premium'::character varying])::text[]));
  END IF;
END $$;

-- 5) expense_categories tenant-isolation policy: production also has WITH CHECK (writes are
--    tenant-checked); the migration defined USING only. ALTER POLICY re-states the same expression.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expense_categories'
      AND policyname = 'tenant_isolation_expense_categories' AND with_check IS NULL
  ) THEN
    ALTER POLICY tenant_isolation_expense_categories ON expense_categories
      WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid);
  END IF;
END $$;

-- 6) Row level security: these tables have RLS ENABLED in production (the Supabase "auto-enable RLS"
--    event trigger rls_auto_enable() turns it on for tables created there) but no migration enables it.
--    Enabling RLS with no permissive policy only restricts non-bypass roles (anon/authenticated);
--    service_role and the table owner bypass it, as in production. Already enabled = no-op.
ALTER TABLE account_roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_owner_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE backorders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_event_source_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_variant_sku_sequences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_barcode_sequences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sku_sequences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                  ENABLE ROW LEVEL SECURITY;
