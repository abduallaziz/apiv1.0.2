-- Purchasing redesign — item #9.3.4: purchase_orders/purchase_order_items
-- gain full lineage back through the award (and, transitively, the
-- supplier quote and RFQ that produced it). Purely additive/nullable —
-- the existing from-scratch PO path (no RFQ at all) keeps working
-- unchanged, all new columns stay NULL for it.

ALTER TABLE purchase_orders ADD COLUMN source_rfq_id UUID REFERENCES rfqs(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN source_supplier_quote_id UUID REFERENCES supplier_quotes(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN source_award_id UUID REFERENCES awards(id) ON DELETE SET NULL;

ALTER TABLE purchase_order_items ADD COLUMN source_supplier_quote_item_id UUID REFERENCES supplier_quote_items(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items ADD COLUMN source_award_item_id UUID REFERENCES award_items(id) ON DELETE SET NULL;
