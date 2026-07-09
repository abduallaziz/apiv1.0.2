-- Both openTable (create order + set table occupied) and checkout (finalize order
-- + set table available) were two separate, unrelated Supabase REST calls each —
-- if the second write failed after the first succeeded (network blip, process
-- restart), the table and its order would permanently disagree about state, the
-- exact class of bug behind the "No open order for this table" incident
-- (STATUS.md §77/§78). Wrapping each pair in a single plpgsql function makes both
-- writes atomic: either both happen or neither does.

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
    INSERT INTO orders (tenant_id, branch_id, cashier_id, table_id, status, subtotal, discount, tax, total)
    VALUES (p_tenant_id, p_branch_id, p_cashier_id, p_table_id, 'pending', 0, 0, 0, 0)
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_checkout_dine_in_table(
  p_tenant_id UUID,
  p_order_id UUID,
  p_table_id UUID,
  p_payment_method TEXT,
  p_customer_id UUID
)
RETURNS SETOF orders AS $$
BEGIN
  UPDATE tables SET status = 'available' WHERE id = p_table_id AND tenant_id = p_tenant_id;

  RETURN QUERY
    UPDATE orders
       SET status = 'completed', payment_method = p_payment_method, customer_id = p_customer_id
     WHERE id = p_order_id AND tenant_id = p_tenant_id AND status = 'pending'
    RETURNING *;
END;
$$ LANGUAGE plpgsql;
