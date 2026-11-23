-- WP-B follow-up (design + LOCAL proof only) — ONE accounting-date policy.
-- NOT wired into any sale/cancel/return path. Not scanned by migrate.ts (migrations_pending/).
-- Adopting it for production needs a separate owner decision (P1-D6): it changes the date on which
-- some entries are posted (only near local midnight) and therefore report totals for that day.
--
-- Policy: posting_date = the TENANT-LOCAL calendar date of the business event.
--   sale    : event = orders.created_at
--   cancel  : event = the moment of cancellation (now)
--   return  : event = the moment the return is recorded (now)
--   A reversal/return can never be dated before the posting date of the entry it reverses.
--   document_date stays the original document's date; closed/locked periods are never reopened:
--   a reversal whose date falls in a closed period fails closed (engine error), it is NOT back-dated.
--   Unknown time-zone name -> UTC (never fail a sale on a bad tenant setting).

CREATE OR REPLACE FUNCTION fn_posting_date_for_event(
  p_tenant_id UUID,
  p_kind TEXT,                       -- 'sale' | 'cancel' | 'return'
  p_event_at TIMESTAMPTZ,
  p_original_posting_date DATE DEFAULT NULL
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_date DATE;
BEGIN
  IF p_kind NOT IN ('sale', 'cancel', 'return') THEN
    RAISE EXCEPTION 'fn_posting_date_for_event: unknown kind %', p_kind;
  END IF;
  IF p_event_at IS NULL THEN
    RAISE EXCEPTION 'fn_posting_date_for_event: event time is required';
  END IF;
  v_date := fn_tenant_posting_date(p_tenant_id, p_event_at);   -- defined in 325
  IF p_kind IN ('cancel', 'return') AND p_original_posting_date IS NOT NULL THEN
    v_date := greatest(v_date, p_original_posting_date);
  END IF;
  RETURN v_date;
END;
$$;

-- Read-only impact report: sales whose CURRENT rule (created_at::date in the DB session zone) differs
-- from the policy date. Run it per tenant/range BEFORE any adoption decision.
CREATE OR REPLACE FUNCTION fn_posting_date_drift(
  p_tenant_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS TABLE (order_id UUID, created_at TIMESTAMPTZ, current_rule_date DATE, policy_date DATE)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT o.id, o.created_at, o.created_at::date, fn_posting_date_for_event(o.tenant_id, 'sale', o.created_at)
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.created_at >= p_from::timestamptz - INTERVAL '1 day'
    AND o.created_at <  p_to::timestamptz + INTERVAL '2 days'
    AND o.created_at::date IS DISTINCT FROM fn_posting_date_for_event(o.tenant_id, 'sale', o.created_at)
    AND fn_posting_date_for_event(o.tenant_id, 'sale', o.created_at) BETWEEN p_from AND p_to
$$;

REVOKE ALL ON FUNCTION fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_posting_date_drift(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fn_posting_date_drift(UUID, DATE, DATE) TO service_role;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS fn_posting_date_drift(UUID, DATE, DATE);
--   DROP FUNCTION IF EXISTS fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE);
