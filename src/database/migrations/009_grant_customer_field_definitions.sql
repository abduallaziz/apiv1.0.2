-- =============================================================================
-- 009: Grant service_role privileges on customer_field_definitions
-- Context: new tables on this Supabase project don't automatically inherit
-- service_role grants (same issue previously hit with expense_categories,
-- see STATUS.md §15) — inserts failed with 42501 "permission denied".
-- =============================================================================

GRANT ALL ON public.customer_field_definitions TO service_role;
ALTER TABLE public.customer_field_definitions DISABLE ROW LEVEL SECURITY;
