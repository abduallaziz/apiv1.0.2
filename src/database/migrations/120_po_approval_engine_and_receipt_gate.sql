-- Inventory/Purchasing redesign — item #9.1: (a) close the real enforcement
-- gap where a goods receipt could be posted against a PO that was never
-- approved (application-layer check added in GoodsReceiptsService, no DB
-- change needed since purchase_order_items already has the FK), and (b)
-- widen purchase_orders.status to support a real 'rejected' terminal state
-- so PurchaseOrdersService can be migrated onto the shared ApprovalEngine
-- (src/engines/approval-engine) exactly like Expenses already does, instead
-- of the bespoke `.eq('status','submitted')` update it had before.
--
-- Confirmed live before this migration: zero real goods_receipts reference
-- a PO in a status the new application-layer gate would have blocked
-- (the one real receipt in production is against an already-'received' PO),
-- and 'purchasing.approve' is only ever granted to the seeded default roles
-- (superadmin/owner/manager) — safe to rename the permission key without
-- silently locking out any custom role.

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'partially_received', 'received', 'cancelled'));
