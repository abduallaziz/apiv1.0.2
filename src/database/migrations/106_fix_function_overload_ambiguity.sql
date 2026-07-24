-- Fixes a real bug from migration 105: CREATE OR REPLACE FUNCTION with an
-- added parameter does NOT replace the old signature in Postgres — a
-- function is identified by (name, parameter types), so adding
-- p_allow_backorder / p_allow_partial created a SECOND overload alongside
-- the old one instead of replacing it. PostgREST's RPC layer then can't
-- disambiguate which overload to call ("Could not choose the best
-- candidate function"), confirmed live: calling fn_apply_stock_movement
-- for a plain 'receipt' (in) movement failed outright.
--
-- Dropping the old-arity signatures explicitly so only the new (105)
-- versions remain — CREATE OR REPLACE further down is then unambiguous.
DROP FUNCTION IF EXISTS fn_apply_stock_movement(
  UUID, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID, UUID, BOOLEAN
);
DROP FUNCTION IF EXISTS fn_consume_cost_layers(UUID, UUID, UUID, UUID, NUMERIC);
