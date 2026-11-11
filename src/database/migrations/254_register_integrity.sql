-- 254. Register integrity (Phase 4 of DESIGN-REVIEW-REGISTER-CLOSE-2026-11-09,
-- owner approved): defects S1, S2 and S6 of the shift/cash-drawer audit.
--
-- S1  one OPEN register per cashier (owner decision Q1: a register per
--     cashier) was only checked by a read-then-write in the service, with a
--     NON-unique index, so two simultaneous opens both succeeded. A partial
--     UNIQUE index now makes it impossible.
-- S2  a completed order could point at ANY open register of the tenant (the
--     client sent shift_id and the server only checked "open"): another
--     cashier's, another branch's. A trigger now requires a completed order
--     that references a register to reference an OPEN register of the SAME
--     cashier and branch. (Orders without shift_id, held orders and every
--     status change other than becoming 'completed' are untouched.)
-- S6  closing was several separate writes (update shift, then counts) with the
--     expected figures computed beforehand: a sale could slip in between, or
--     the counts could fail after the shift was already closed. fn_close_shift
--     locks the register, checks that its activity is still what the figures
--     were computed from, and writes the closing + the per-method counts in
--     ONE transaction.

-- ---- S1 --------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_cashier
  ON shifts (tenant_id, cashier_id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ---- S2 --------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_orders_require_open_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_shift RECORD;
BEGIN
  IF NEW.status = 'completed'
     AND NEW.shift_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN

    -- FOR SHARE: a concurrent fn_close_shift (FOR UPDATE) waits for this
    -- sale to commit, and a sale that starts after the close sees 'closed'.
    SELECT id, tenant_id, status, cashier_id, branch_id INTO v_shift
    FROM shifts WHERE id = NEW.shift_id FOR SHARE;

    IF NOT FOUND OR v_shift.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'NO_ACTIVE_CASH_SESSION: order references an unknown register session';
    END IF;
    IF v_shift.status <> 'open' THEN
      RAISE EXCEPTION 'NO_ACTIVE_CASH_SESSION: the register session is not open';
    END IF;
    IF NEW.cashier_id IS DISTINCT FROM v_shift.cashier_id THEN
      RAISE EXCEPTION 'NO_ACTIVE_CASH_SESSION: the register session belongs to another cashier';
    END IF;
    IF NEW.branch_id IS DISTINCT FROM v_shift.branch_id THEN
      RAISE EXCEPTION 'NO_ACTIVE_CASH_SESSION: the register session belongs to another branch';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_require_open_shift ON orders;
CREATE TRIGGER trg_orders_require_open_shift
  BEFORE INSERT OR UPDATE OF status, shift_id ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_orders_require_open_shift();

-- ---- S6 --------------------------------------------------------------
-- p_counts: [{ "payment_method": "cash", "counted": 0, "expected": 0, "difference": 0 }, ...]
-- p_expect_*: the fingerprint of the register's activity the caller computed
-- its figures from (completed orders and returns attached to the register).
-- If the activity changed meanwhile the function raises
-- SHIFT_ACTIVITY_CHANGED and writes nothing; the caller recomputes and retries.
CREATE OR REPLACE FUNCTION fn_close_shift(
  p_tenant_id            uuid,
  p_shift_id             uuid,
  p_closed_by            uuid,
  p_closing_cash         numeric,
  p_expected_cash        numeric,
  p_discrepancy          numeric,
  p_notes                text,
  p_closed_at            timestamptz,
  p_report               jsonb,
  p_counts               jsonb,
  p_expect_orders        integer,
  p_expect_orders_total  numeric,
  p_expect_returns       integer,
  p_expect_returns_total numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shift     RECORD;
  v_orders    INTEGER;
  v_orders_t  NUMERIC;
  v_returns   INTEGER := 0;
  v_returns_t NUMERIC := 0;
BEGIN
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_shift_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift already closed';
  END IF;

  SELECT count(*), COALESCE(sum(total), 0) INTO v_orders, v_orders_t
  FROM orders
  WHERE tenant_id = p_tenant_id AND shift_id = p_shift_id AND status = 'completed';

  -- sales_returns exists since migration 253
  IF to_regclass('public.sales_returns') IS NOT NULL THEN
    EXECUTE 'SELECT count(*), COALESCE(sum(refund_total), 0) FROM sales_returns
             WHERE tenant_id = $1 AND shift_id = $2 AND deleted_at IS NULL'
      INTO v_returns, v_returns_t USING p_tenant_id, p_shift_id;
  END IF;

  IF v_orders <> p_expect_orders
     OR abs(v_orders_t - p_expect_orders_total) > 0.005
     OR v_returns <> p_expect_returns
     OR abs(v_returns_t - p_expect_returns_total) > 0.005 THEN
    RAISE EXCEPTION 'SHIFT_ACTIVITY_CHANGED';
  END IF;

  UPDATE shifts SET
    status          = 'closed',
    closing_cash    = p_closing_cash,
    expected_cash   = p_expected_cash,
    discrepancy     = p_discrepancy,
    closed_at       = p_closed_at,
    closed_by       = p_closed_by,
    close_notes     = p_notes,
    report_snapshot = p_report
  WHERE id = p_shift_id;

  INSERT INTO shift_counts (tenant_id, shift_id, payment_method, counted, expected, difference)
  SELECT p_tenant_id, p_shift_id, c.payment_method, c.counted, c.expected, c.difference
  FROM jsonb_to_recordset(COALESCE(p_counts, '[]'::jsonb))
       AS c(payment_method text, counted numeric, expected numeric, difference numeric);

  RETURN (SELECT to_jsonb(s) FROM shifts s WHERE s.id = p_shift_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION fn_close_shift(uuid, uuid, uuid, numeric, numeric, numeric, text, timestamptz, jsonb, jsonb, integer, numeric, integer, numeric) TO service_role;

-- ROLLBACK (manual, if ever needed):
-- DROP FUNCTION IF EXISTS fn_close_shift(uuid, uuid, uuid, numeric, numeric, numeric, text, timestamptz, jsonb, jsonb, integer, numeric, integer, numeric);
-- DROP TRIGGER IF EXISTS trg_orders_require_open_shift ON orders;
-- DROP FUNCTION IF EXISTS fn_orders_require_open_shift();
-- DROP INDEX IF EXISTS uq_shifts_one_open_per_cashier;
