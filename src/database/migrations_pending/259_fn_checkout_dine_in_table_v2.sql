-- 259_fn_checkout_dine_in_table_v2.sql   (PENDING — not applied, not yet verified on a database)
-- P1: atomic dine-in checkout that (a) confirms the order is still pending BEFORE freeing the
-- table (v1 freed the table even when the order was not pending), (b) records shift and the
-- split cash/card breakdown, (c) re-checks the customer belongs to the tenant.
-- New function name => no overload problem; fn_checkout_dine_in_table (072) is left untouched
-- until the API has switched (dropped in the cutover migration).
-- Prerequisite: orders.shift_id (001/254), orders.cash_amount/card_amount (188) exist.

CREATE OR REPLACE FUNCTION fn_checkout_dine_in_table_v2(
  p_tenant_id      UUID,
  p_order_id       UUID,
  p_table_id       UUID,
  p_payment_method TEXT,
  p_customer_id    UUID,
  p_shift_id       UUID,
  p_cash_amount    NUMERIC,
  p_card_amount    NUMERIC
)
RETURNS SETOF orders
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Customer not found for this tenant';
  END IF;

  UPDATE orders
     SET status         = 'completed',
         payment_method = p_payment_method,
         customer_id    = p_customer_id,
         shift_id       = COALESCE(p_shift_id, shift_id),
         cash_amount    = CASE WHEN p_payment_method = 'split' THEN p_cash_amount END,
         card_amount    = CASE WHEN p_payment_method = 'split' THEN p_card_amount END
   WHERE id = p_order_id AND tenant_id = p_tenant_id AND status = 'pending'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RETURN;  -- not pending / not this tenant: table is left untouched
  END IF;

  UPDATE tables SET status = 'available'
   WHERE id = p_table_id AND tenant_id = p_tenant_id;

  RETURN NEXT v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_checkout_dine_in_table_v2(UUID, UUID, UUID, TEXT, UUID, UUID, NUMERIC, NUMERIC) TO service_role;

-- ROLLBACK: DROP FUNCTION IF EXISTS fn_checkout_dine_in_table_v2(UUID, UUID, UUID, TEXT, UUID, UUID, NUMERIC, NUMERIC);
