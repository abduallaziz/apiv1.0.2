-- 278_fix_sales_return_search_path.sql  (owner-approved: "Approved – Proceed with Implementation")
-- Problem: POST /invoices/:id/returns/preview answers HTTP 500 on production.
-- fn_create_sales_return (253) is SECURITY DEFINER with `SET search_path TO 'public'` and calls
-- uuid_generate_v4() in its DECLARE block. On Supabase that function lives in the `extensions`
-- schema, so with search_path = public only the call fails ("function uuid_generate_v4() does not
-- exist"). Locally the extension is installed in `public`, which hid the problem.
-- Fix: widen the function's search_path to include `extensions` (and pg_catalog). No logic change.
-- Idempotent: ALTER FUNCTION ... SET can be applied any number of times; a non-existent schema in
-- search_path is harmless.
-- ROLLBACK: ALTER FUNCTION fn_create_sales_return(uuid, uuid, uuid, uuid, text, jsonb, boolean)
--           SET search_path TO 'public';

ALTER FUNCTION fn_create_sales_return(uuid, uuid, uuid, uuid, text, jsonb, boolean)
  SET search_path TO 'public', 'extensions', 'pg_catalog';
