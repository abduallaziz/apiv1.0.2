-- =============================================================================
-- 029: Grant service_role privileges on inventory/purchasing tables
-- Context: same recurring issue as migration 009 (see STATUS.md §15) — new
-- tables on this Supabase project don't automatically inherit service_role
-- grants. Migrations 016-018 enabled RLS on all inventory/purchasing tables
-- but never granted privileges to service_role and never disabled RLS, so
-- every INSERT/UPDATE/DELETE through the backend (which authenticates as
-- service_role) failed with 42501 "permission denied for table warehouses"
-- (and would fail identically on every other table below).
-- =============================================================================

GRANT ALL ON public.warehouses TO service_role;
GRANT ALL ON public.warehouse_locations TO service_role;
GRANT ALL ON public.suppliers TO service_role;
GRANT ALL ON public.item_batches TO service_role;
GRANT ALL ON public.inventory_reorder_points TO service_role;
GRANT ALL ON public.stock_movements TO service_role;
GRANT ALL ON public.stock_levels TO service_role;
GRANT ALL ON public.cost_layers TO service_role;
GRANT ALL ON public.stock_reservations TO service_role;
GRANT ALL ON public.purchase_orders TO service_role;
GRANT ALL ON public.purchase_order_items TO service_role;
GRANT ALL ON public.goods_receipts TO service_role;
GRANT ALL ON public.goods_receipt_items TO service_role;
GRANT ALL ON public.stock_adjustments TO service_role;
GRANT ALL ON public.stock_transfers TO service_role;
GRANT ALL ON public.stock_transfer_items TO service_role;
GRANT ALL ON public.stock_counts TO service_role;
GRANT ALL ON public.stock_count_items TO service_role;
GRANT ALL ON public.domain_events_outbox TO service_role;

ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reorder_points DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_layers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events_outbox DISABLE ROW LEVEL SECURITY;
