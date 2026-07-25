-- Real gap discovered live while verifying migration 114 (unit-conversion
-- work): migration 093 created `units`/`brands` without the
-- service_role GRANT that every other tenant table gets — same class of
-- bug that caused the real item-barcodes 500 (migrations 099/100).
-- service_role's rolbypassrls=true only bypasses RLS, not the
-- table-level GRANT Postgres still requires separately.

GRANT ALL PRIVILEGES ON public.units TO service_role;
GRANT ALL PRIVILEGES ON public.brands TO service_role;
