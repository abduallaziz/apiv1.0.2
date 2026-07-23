-- Same recurring gotcha as migrations 066 and 089: migration 098 created
-- item_barcodes with RLS enabled but never GRANTed service_role privileges
-- on the table itself. service_role has rolbypassrls = true, which only
-- skips row-level policies — it does not substitute for the table-level
-- GRANT Postgres still requires.
--
-- Confirmed directly: POST /api/v1/item-barcodes returned 500, root cause
-- traced to the real Postgres error "permission denied for table
-- item_barcodes" (42501), with hint "GRANT SELECT, UPDATE ON
-- public.item_barcodes TO service_role."
GRANT ALL PRIVILEGES ON public.item_barcodes TO service_role;

-- ============================================================
-- VERIFICATION (run manually after apply)
-- ============================================================
-- SELECT table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_name = 'item_barcodes' AND grantee = 'service_role'
-- ORDER BY privilege_type;
