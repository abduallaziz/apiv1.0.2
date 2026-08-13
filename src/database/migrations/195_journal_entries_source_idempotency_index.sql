-- 195 — journal_entries posting idempotency, defense-in-depth
-- (M184 Integration, approved 2026-08-13). "APPROVED — PROCEED WITH M184
-- IMPLEMENTATION." Deliberately a separate, append-only migration from
-- 194 (payment mapping / COGS flag), per explicit instruction.
--
-- fn_post_sales_order()'s own EXISTS-check-under-row-lock (unchanged,
-- migration 184/194) is the primary, always-exercised idempotency
-- guarantee for the sanctioned posting path. This index closes the
-- separate, currently-theoretical gap where a direct INSERT bypassing
-- that function could create a duplicate posting for the same source
-- event — it does not change or replace the function's own check.
--
-- Pre-migration verification performed live (read-only, not part of this
-- file): confirmed zero duplicate (tenant_id, source_module,
-- source_entity_type, source_entity_id) combinations exist among rows
-- with reversal_of_id IS NULL — the only 2 existing journal_entries rows
-- are a single posted/reversed pair from migration 184's own validation;
-- the reversal row has reversal_of_id set (non-null), so only the
-- original row falls within this partial index's scope, and it is
-- alone for its source. Index creation is safe against current data.
--
-- Reversal compatibility (verified against fn_reverse_journal_entry's
-- actual INSERT, migration 182): every reversal row it creates copies
-- source_module/source_entity_type/source_entity_id from the original
-- AND sets reversal_of_id to the original's id (non-null) — placing it
-- outside this partial index's WHERE clause entirely. The original row
-- keeps reversal_of_id = NULL and its own single slot in the index, so a
-- reversed order can never be re-posted or misidentified as a duplicate.

CREATE UNIQUE INDEX uq_journal_entries_source
  ON journal_entries (tenant_id, source_module, source_entity_type, source_entity_id)
  WHERE reversal_of_id IS NULL;

-- Rollback (documented, not auto-executed):
-- DROP INDEX IF EXISTS uq_journal_entries_source;
