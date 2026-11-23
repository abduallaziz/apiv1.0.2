-- WP-B follow-up (design + LOCAL proof only) — ONE accounting-date policy, STRICT time zone.
-- NOT wired into any sale/cancel/return path. Not scanned by migrate.ts (migrations_pending/).
-- Adopting it for production needs a separate owner decision (P1-D6) plus the gates in
-- POSTING_DATE_DECISION_REPORT.md (zone audit = 0 invalid rows first).
--
-- Concepts kept separate (see the report):
--   event time (UTC instant)  /  business document date  /  accounting posting date (this function)
--   /  fiscal period (derived from the posting date by the engine)  /  reversal-return date  /  already-posted entries (immutable).
--
-- Policy: posting_date = tenant-local calendar date of the business event, using the tenant's EXPLICITLY
-- STORED, VALIDATED IANA zone. There is NO fallback: blank/unknown zone => the function raises
-- 'invalid_tenant_timezone' and any enclosing sale transaction rolls back (a sale is never saved without its
-- entry, and never silently dated in another zone).
--   sale    : event = orders.created_at
--   cancel  : event = moment of cancellation        } date >= original entry's posting date (floor, reported)
--   return  : event = moment the return is recorded }
-- Closed/locked periods are never reopened: this function only CHOOSES a date; fn_post_journal_entry still
-- refuses a closed/locked period and the whole transaction rolls back.

-- 1. Zone validity (IANA names only; abbreviations such as 'EST' are rejected on purpose)
CREATE OR REPLACE FUNCTION fn_is_valid_timezone(p_tz TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_tz IS NOT NULL AND btrim(p_tz) <> '' AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz)
$$;

-- 2. Write guard: a NEW or CHANGED tenants.timezone must be valid. Rows already stored are not touched, and
--    updates that do not change the column are not blocked (legacy rows are reported by the audit below).
CREATE OR REPLACE FUNCTION fn_tenants_timezone_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF NOT fn_is_valid_timezone(NEW.timezone) THEN
      RAISE EXCEPTION 'invalid_tenant_timezone: "%" is not a valid IANA time zone', coalesce(NEW.timezone, '<null>')
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_timezone_guard ON tenants;
CREATE TRIGGER trg_tenants_timezone_guard
  BEFORE INSERT OR UPDATE OF timezone ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_tenants_timezone_guard();

-- 3. Read-only audit of existing tenants (the adoption gate: must return no 'blank'/'invalid' rows)
CREATE OR REPLACE FUNCTION fn_tenant_timezone_audit()
RETURNS TABLE (tenant_id UUID, timezone TEXT, status TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.timezone,
         CASE WHEN t.timezone IS NULL OR btrim(t.timezone) = '' THEN 'blank'
              WHEN fn_is_valid_timezone(t.timezone) THEN 'valid'
              ELSE 'invalid' END
  FROM tenants t
$$;

-- 4. The policy. _detail also tells the caller whether the "never before the original" floor was applied,
--    so a date that differs from the event's own local date is never silent (log/audit it).
CREATE OR REPLACE FUNCTION fn_posting_date_detail(
  p_tenant_id UUID,
  p_kind TEXT,                       -- 'sale' | 'cancel' | 'return'
  p_event_at TIMESTAMPTZ,
  p_original_posting_date DATE DEFAULT NULL
) RETURNS TABLE (posting_date DATE, event_local_date DATE, floored BOOLEAN)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_local DATE;
BEGIN
  IF p_kind NOT IN ('sale', 'cancel', 'return') THEN
    RAISE EXCEPTION 'fn_posting_date_for_event: unknown kind %', p_kind;
  END IF;
  IF p_event_at IS NULL THEN
    RAISE EXCEPTION 'fn_posting_date_for_event: event time is required';
  END IF;
  v_local := fn_tenant_posting_date(p_tenant_id, p_event_at);   -- strict, defined in 325
  IF p_kind IN ('cancel', 'return') AND p_original_posting_date IS NOT NULL AND p_original_posting_date > v_local THEN
    RETURN QUERY SELECT p_original_posting_date, v_local, TRUE;
  ELSE
    RETURN QUERY SELECT v_local, v_local, FALSE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_posting_date_for_event(
  p_tenant_id UUID, p_kind TEXT, p_event_at TIMESTAMPTZ, p_original_posting_date DATE DEFAULT NULL
) RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT posting_date FROM fn_posting_date_detail(p_tenant_id, p_kind, p_event_at, p_original_posting_date)
$$;

-- 5. Read-only impact report: sales whose CURRENT rule (created_at::date in the DB session zone) differs from the
--    policy date. Raises for a tenant with an invalid zone (fix the zone first — see the audit).
CREATE OR REPLACE FUNCTION fn_posting_date_drift(
  p_tenant_id UUID, p_from DATE, p_to DATE
) RETURNS TABLE (order_id UUID, created_at TIMESTAMPTZ, current_rule_date DATE, policy_date DATE)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT x.id, x.created_at, x.cur, x.pol
  FROM (
    SELECT o.id, o.created_at, o.created_at::date AS cur,
           fn_posting_date_for_event(o.tenant_id, 'sale', o.created_at) AS pol
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.created_at >= p_from::timestamptz - INTERVAL '1 day'
      AND o.created_at <  p_to::timestamptz + INTERVAL '2 days'
  ) x
  WHERE x.cur IS DISTINCT FROM x.pol AND x.pol BETWEEN p_from AND p_to
$$;

REVOKE ALL ON FUNCTION fn_is_valid_timezone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_tenants_timezone_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_tenant_timezone_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_posting_date_detail(UUID, TEXT, TIMESTAMPTZ, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_posting_date_drift(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_is_valid_timezone(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_tenant_timezone_audit() TO service_role;
GRANT EXECUTE ON FUNCTION fn_posting_date_detail(UUID, TEXT, TIMESTAMPTZ, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fn_posting_date_drift(UUID, DATE, DATE) TO service_role;

-- ROLLBACK (exercised locally):
--   DROP FUNCTION IF EXISTS fn_posting_date_drift(UUID, DATE, DATE);
--   DROP FUNCTION IF EXISTS fn_posting_date_for_event(UUID, TEXT, TIMESTAMPTZ, DATE);
--   DROP FUNCTION IF EXISTS fn_posting_date_detail(UUID, TEXT, TIMESTAMPTZ, DATE);
--   DROP FUNCTION IF EXISTS fn_tenant_timezone_audit();
--   DROP TRIGGER IF EXISTS trg_tenants_timezone_guard ON tenants;
--   DROP FUNCTION IF EXISTS fn_tenants_timezone_guard();
--   DROP FUNCTION IF EXISTS fn_is_valid_timezone(TEXT);
