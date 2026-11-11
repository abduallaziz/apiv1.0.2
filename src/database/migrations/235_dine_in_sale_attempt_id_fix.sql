-- Dine-in sale_attempt_id contract fix (Owner-approved) — discovered during
-- the POS audit as the same defect already found and fixed in
-- InvoicesService.holdOrder() (see 187_sale_idempotency.sql, which drops
-- orders.sale_attempt_id's DB-side DEFAULT after backfill so every future
-- INSERT must supply an explicit value from the application/function
-- itself). fn_open_dine_in_table is the ONLY order-creation path in the
-- Tables/Dine-in flow (confirmed: fn_checkout_dine_in_table only UPDATEs
-- an existing order; every other tables/dine-in write is order_items,
-- unaffected by this constraint) and was never updated to comply, so
-- opening a dine-in table currently fails with a NOT NULL violation.
--
-- Opening a table has no client-supplied sale_attempt_id (unlike POS
-- checkout, which passes one explicitly for double-click/idempotency
-- protection) and doesn't need one for that purpose either — a table can
-- only be opened once while its own status is 'available', already
-- enforced by the existing `FOR UPDATE` row lock on `tables` inside this
-- same function, which is the real duplicate-prevention mechanism here.
-- A server-generated UUID via uuid_generate_v4() (same generator already
-- used for every other UUID column and by migration 187's own historical
-- backfill) is the correct, minimal way to satisfy the NOT NULL contract
-- without inventing new client-facing idempotency semantics this flow
-- doesn't need.
CREATE OR REPLACE FUNCTION fn_open_dine_in_table(
  p_tenant_id UUID,
  p_table_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID
)
RETURNS SETOF orders AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM tables WHERE id = p_table_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Table is not available (status: %)', v_status;
  END IF;

  UPDATE tables SET status = 'occupied' WHERE id = p_table_id;

  RETURN QUERY
    INSERT INTO orders (tenant_id, branch_id, cashier_id, table_id, status, subtotal, discount, tax, total, sale_attempt_id)
    VALUES (p_tenant_id, p_branch_id, p_cashier_id, p_table_id, 'pending', 0, 0, 0, 0, uuid_generate_v4())
    RETURNING *;
END;
$$ LANGUAGE plpgsql;
