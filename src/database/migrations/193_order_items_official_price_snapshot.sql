-- 193 — order_items.official_price_snapshot (D01-M4, approved 2026-08-13)
-- "Approved – Proceed with D01-M4." Scope, exactly as designed: a single
-- nullable column, permanently nullable by design — there is no reliable
-- historical price record for items/item_variants in this project (both
-- are live-mutable fields with no audit trail), so backfilling this
-- column from current items.price/item_variants.price_adjustment for the
-- 380 existing order_items would fabricate historical data that cannot be
-- proven correct. Those 380 rows remain NULL permanently.
--
-- Semantics (enforced at the application layer starting D01-M7, not here):
-- official_price_snapshot = items.price + COALESCE(item_variants.price_adjustment, 0),
-- captured at Price Resolution time, before Override and before Discount,
-- immutable after order_item creation (no UPDATE path exists on
-- order_items anywhere in this codebase, so no trigger is needed).
--
-- Does NOT touch: order_items.price, tenant_id, any trigger, any existing
-- row's data, resolveEffectiveRole(), PriceResolutionService,
-- InvoicesService, any UI.

ALTER TABLE order_items ADD COLUMN official_price_snapshot NUMERIC(10,2);

-- Rollback (documented, not auto-executed):
-- ALTER TABLE order_items DROP COLUMN IF EXISTS official_price_snapshot;
