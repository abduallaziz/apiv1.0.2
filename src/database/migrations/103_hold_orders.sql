-- Hold & Resume Orders — POS feature.
--
-- A held order is a real row in `orders` (status='pending', held=true) so it
-- can reuse the existing orders/order_items schema and eventually flow
-- through the SAME unmodified checkout endpoint (POST /invoices) once
-- resumed — no new table, no change to InvoicesService.create(). Holding
-- never touches payment/stock/coupon/loyalty logic; those only run when
-- the resumed cart is actually checked out through the existing flow.
--
-- held_visibility controls whether other cashiers on the same branch can
-- see and resume this ticket ('all_cashiers') or only the cashier who
-- held it ('self'). Enforced at the application/repository query layer
-- (WHERE held_visibility='all_cashiers' OR held_by=current_user), same
-- as every other business-rule filter in this codebase — RLS on `orders`
-- today is SELECT-only for the Realtime/anon role and does not gate
-- service_role writes (confirmed: only one existing policy,
-- realtime_tenant_select, tenant-scoped only, no held_visibility logic
-- belongs in a database policy since it depends on request-time actor
-- identity the service_role connection doesn't carry).
ALTER TABLE orders ADD COLUMN held BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN held_visibility TEXT CHECK (held_visibility IN ('self', 'all_cashiers'));
ALTER TABLE orders ADD COLUMN held_by UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN held_at TIMESTAMPTZ;

CREATE INDEX idx_orders_held ON orders(tenant_id, branch_id, held) WHERE held = true;
