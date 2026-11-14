-- 301_branch_accounting_trial_balance.sql  (Branch isolation P5 / Task 5a — D9)
-- Branch ownership of the ledger needs NO schema change: journal_entries are immutable once posted, and
-- every entry is already reachable to its branch through book -> accounting_owner.branch_id (migrations 177/180;
-- every branch gets its own owner + default book at creation). Visibility is therefore resolved in the application
-- by restricting accounting_book_id to the books of the branch's owner(s).
-- This migration only adds a READ-ONLY aggregate so per-branch account balances do not depend on PostgREST row caps.
-- It does not touch posting functions, accounts, roles or fiscal tables.
-- ROLLBACK: DROP FUNCTION IF EXISTS fn_trial_balance(uuid, uuid[]);

CREATE OR REPLACE FUNCTION fn_trial_balance(p_tenant_id uuid, p_book_ids uuid[] DEFAULT NULL)
RETURNS TABLE (account_id uuid, debit_total numeric, credit_total numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT jl.account_id,
         COALESCE(SUM(jl.debit_amount), 0)::numeric  AS debit_total,
         COALESCE(SUM(jl.credit_amount), 0)::numeric AS credit_total
    FROM journal_lines jl
    JOIN journal_entries je
      ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id
   WHERE jl.tenant_id = p_tenant_id
     AND je.status IN ('posted', 'reversed')
     AND (p_book_ids IS NULL OR je.accounting_book_id = ANY (p_book_ids))
   GROUP BY jl.account_id;
$$;

REVOKE ALL ON FUNCTION fn_trial_balance(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_trial_balance(uuid, uuid[]) TO service_role;
