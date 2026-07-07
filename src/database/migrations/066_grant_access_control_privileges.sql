-- Migrations 059 (roles), 064 (tenant_role_permissions), and 065
-- (permission_groups) created these tables without granting service_role
-- privileges, following the same pattern that previously caused migration
-- 048's "permission denied for table work_schedules" (42501) incident.
-- Confirmed directly against production: service_role currently has only
-- REFERENCES/TRIGGER/TRUNCATE on these three tables — SELECT/INSERT/UPDATE/
-- DELETE were never granted, causing every /access-control/* request to fail
-- with 42501 "permission denied".
--
-- None of these three tables use a serial/bigserial id (all use
-- uuid_generate_v4()), so there are no owned sequences to grant privileges
-- on — verified against pg_depend before writing this migration.
--
-- Additive and reversible: this only adds privileges, touches no data, no
-- schema, and no other table.

GRANT ALL PRIVILEGES ON public.roles TO service_role;
GRANT ALL PRIVILEGES ON public.permission_groups TO service_role;
GRANT ALL PRIVILEGES ON public.tenant_role_permissions TO service_role;

-- ============================================================
-- VERIFICATION QUERIES (for post-deploy confirmation — not executed
-- automatically by this migration; run manually after it applies)
-- ============================================================

-- 1. Confirm service_role now has full CRUD privileges on all three tables.
--    Expected: SELECT, INSERT, UPDATE, DELETE (plus the pre-existing
--    REFERENCES/TRIGGER/TRUNCATE) present for each table.
-- SELECT table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_name IN ('roles', 'permission_groups', 'tenant_role_permissions')
--   AND grantee = 'service_role'
-- ORDER BY table_name, privilege_type;

-- 2. Smoke test: GET /access-control/roles should now return 200 instead of
--    500/42501 for the same request that originally failed.

-- ============================================================
-- ROLLBACK (only if ever needed — not expected)
-- ============================================================
-- REVOKE ALL PRIVILEGES ON public.roles FROM service_role;
-- REVOKE ALL PRIVILEGES ON public.permission_groups FROM service_role;
-- REVOKE ALL PRIVILEGES ON public.tenant_role_permissions FROM service_role;
-- (Would immediately reintroduce the 42501 errors this migration fixes —
-- there is no reason to ever run this.)
