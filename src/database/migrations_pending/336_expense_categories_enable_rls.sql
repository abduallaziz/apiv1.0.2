-- 336_expense_categories_enable_rls.sql  (R-RLS, found by a read-only catalog check of production on 2026-11-24)
-- Production state: expense_categories has ROW LEVEL SECURITY DISABLED (its tenant_isolation policy is inert) while the
-- public roles `anon` and `authenticated` hold SELECT/INSERT/UPDATE/DELETE on it => anyone with the public anon key can
-- read, change and delete every tenant's expense categories through the REST API.
-- Fix: enable RLS (the existing policy then applies) and remove the public roles' table privileges. The API uses the
-- service_role key (BYPASSRLS), so application behaviour is unchanged.
-- Idempotent; no data is touched. ROLLBACK: rollback/336_expense_categories_enable_rls_ROLLBACK.sql
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE expense_categories FROM anon, authenticated;
