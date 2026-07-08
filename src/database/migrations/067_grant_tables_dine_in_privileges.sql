-- Migration 045 (tables_and_dine_in) created `tables`, `table_reservations`,
-- and `waitlist_entries` without granting service_role privileges — the
-- exact same recurring gap as migration 048 and migration 066. It went
-- unnoticed because 045 had never actually been applied to production
-- (see STATUS.md §67: "migration 045 لم تُطبَّق على production/staging بعد").
-- It finally ran as a pending migration during a later deploy, and
-- immediately surfaced as "permission denied for table tables" (42501) on
-- GET /tables and GET /kitchen/orders — confirmed directly against
-- production: service_role had only REFERENCES/TRIGGER/TRUNCATE on all
-- three tables, exactly like the two prior incidents.

GRANT ALL PRIVILEGES ON public.tables TO service_role;
GRANT ALL PRIVILEGES ON public.table_reservations TO service_role;
GRANT ALL PRIVILEGES ON public.waitlist_entries TO service_role;

-- ============================================================
-- VERIFICATION QUERIES (for post-deploy confirmation — not executed
-- automatically by this migration; run manually after it applies)
-- ============================================================

-- SELECT table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_name IN ('tables', 'table_reservations', 'waitlist_entries')
--   AND grantee = 'service_role'
-- ORDER BY table_name, privilege_type;

-- Smoke test: GET /tables and GET /kitchen/orders should return 200 instead
-- of 500/42501 for the same request that originally failed.
