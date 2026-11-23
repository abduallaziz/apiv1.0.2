-- 325 — WP-B: fiscal-year continuity (generation, dry-run, coverage monitor).
--
-- STATUS: PENDING — authored in migrations_pending/ on purpose. migrate.ts scans only
-- src/database/migrations, so a deploy can NOT apply this file. Applied so far to the
-- LOCAL disposable test database only. Moving it to migrations/ (and running the
-- one-time backfill) are owner-approved production steps (stop points SP-7/SP-8).
--
-- Why: every tenant has exactly ONE fiscal year, generated at registration or backfill
-- (accounting-bootstrap.service.ts, 186_*.sql); nothing ever generates the next one, so
-- posting fails from the first date after the last period (fn_post_journal_entry raises
-- "No fiscal period covers posting date"). For tenants created in 2026 that is 2027-01-01.
--
-- Hard facts this file respects (migration 179):
--   * fiscal_years / fiscal_periods are APPEND-ONLY (DELETE is rejected, dates immutable,
--     only `status` may change). A wrongly generated year cannot be removed by normal means,
--     so generation is conservative: contiguous years only, bounded horizon, dry-run default.
--   * uq_fiscal_years_tenant_label and the EXCLUDE gist constraints prevent duplicate labels
--     and overlapping years/periods; this file never works around them.
--   * Existing rows are never updated or deleted; a closed/locked period is never touched
--     (new years are created 'open', old ones keep their status).
--   * fn_generate_fiscal_year() (the sole sanctioned generator) is called unchanged.
--
-- Additive only: new functions + one view. No table/column/function is altered or dropped.

-- ---------------------------------------------------------------------------
-- 1. Tenant-local accounting date (helper; NOT wired into the sale path — see P1-D6)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tenant_posting_date(p_tenant_id UUID, p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  SELECT nullif(btrim(timezone), '') INTO v_tz FROM tenants WHERE id = p_tenant_id;
  -- STRICT: no silent fallback. The zone must be a real IANA zone (pg_timezone_names); otherwise the
  -- caller (and any enclosing sale transaction) fails closed with a clear, greppable error.
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION 'invalid_tenant_timezone: tenant % has no valid IANA time zone (value: %)', p_tenant_id, coalesce(v_tz, '<blank>')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN (p_at AT TIME ZONE v_tz)::date;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Coverage view: how far each tenant's fiscal calendar reaches
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fiscal_coverage AS
  SELECT t.id                                   AS tenant_id,
         fc.id                                  AS fiscal_calendar_id,
         min(fy.start_date)                     AS first_start_date,
         max(fy.end_date)                       AS covered_until,        -- exclusive end date
         (max(fy.end_date) - CURRENT_DATE)      AS days_remaining,
         count(fy.id)                           AS fiscal_years,
         count(*) FILTER (WHERE fy.status = 'open') AS open_years
  FROM tenants t
  JOIN fiscal_calendars fc ON fc.tenant_id = t.id AND fc.effective_to IS NULL
  LEFT JOIN fiscal_years fy ON fy.tenant_id = t.id
  WHERE t.deleted_at IS NULL
  GROUP BY t.id, fc.id;

-- ---------------------------------------------------------------------------
-- 3. Plan (dry-run core): what WOULD be created. Read-only. Never writes.
--    action: 'create' | 'covered' | 'refuse'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_plan_fiscal_years(p_tenant_id UUID, p_through_date DATE)
RETURNS TABLE (
  seq          INTEGER,
  action       TEXT,
  fiscal_calendar_id UUID,
  year_label   TEXT,
  start_date   DATE,
  end_date     DATE,
  detail       TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_cal        fiscal_calendars%ROWTYPE;
  v_last_end   DATE;
  v_next_start DATE;
  v_next_end   DATE;
  v_candidate  DATE;
  v_seq        INTEGER := 0;
  v_max_years  CONSTANT INTEGER := 5;   -- append-only tables: never plan more than 5 years ahead
BEGIN
  IF p_through_date IS NULL THEN
    RETURN QUERY SELECT 1, 'refuse', NULL::uuid, NULL::text, NULL::date, NULL::date, 'through date is required';
    RETURN;
  END IF;

  SELECT * INTO v_cal FROM fiscal_calendars WHERE tenant_id = p_tenant_id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 1, 'refuse', NULL::uuid, NULL::text, NULL::date, NULL::date, 'tenant has no current fiscal calendar (accounting not bootstrapped)';
    RETURN;
  END IF;

  SELECT max(fy.end_date) INTO v_last_end FROM fiscal_years fy WHERE fy.tenant_id = p_tenant_id;
  IF v_last_end IS NULL THEN
    RETURN QUERY SELECT 1, 'refuse', v_cal.id, NULL::text, NULL::date, NULL::date, 'tenant has a calendar but no fiscal year; first year must come from the accounting bootstrap';
    RETURN;
  END IF;

  -- existing years must be contiguous: a gap means a date range nobody can post into, and
  -- generating on top of it would silently hide it behind a later year
  IF EXISTS (
    SELECT 1 FROM fiscal_years y
    WHERE y.tenant_id = p_tenant_id
      AND y.start_date > (SELECT min(f.start_date) FROM fiscal_years f WHERE f.tenant_id = p_tenant_id)
      AND NOT EXISTS (SELECT 1 FROM fiscal_years z WHERE z.tenant_id = p_tenant_id AND z.end_date = y.start_date)
  ) THEN
    RETURN QUERY SELECT 1, 'refuse', v_cal.id, NULL::text, NULL::date, NULL::date,
      'existing fiscal years are not contiguous (gap between years); fix the calendar data first';
    RETURN;
  END IF;

  IF p_through_date > (CURRENT_DATE + make_interval(years => v_max_years))::date THEN
    RETURN QUERY SELECT 1, 'refuse', v_cal.id, NULL::text, NULL::date, NULL::date,
      format('through date %s is more than %s years ahead; generated years can never be deleted', p_through_date, v_max_years);
    RETURN;
  END IF;

  -- end_date is exclusive (start + 1 year): a date is covered when date < last end
  IF p_through_date < v_last_end THEN
    RETURN QUERY SELECT 1, 'covered', v_cal.id, NULL::text, NULL::date, v_last_end,
      format('already covered until %s (exclusive)', v_last_end);
    RETURN;
  END IF;

  v_next_start := v_last_end;
  WHILE v_next_start <= p_through_date LOOP
    v_seq := v_seq + 1;
    -- the generator computes start = make_date(calendar_year, start_month, start_day):
    -- the next start must be exactly that date for the calendar year it falls in.
    v_candidate := make_date(EXTRACT(YEAR FROM v_next_start)::int, v_cal.start_month, v_cal.start_day);
    IF v_candidate <> v_next_start THEN
      RETURN QUERY SELECT v_seq, 'refuse', v_cal.id, NULL::text, v_next_start, NULL::date,
        format('calendar start %s/%s does not align with the previous year end %s (calendar changed or gap)',
               v_cal.start_month, v_cal.start_day, v_next_start);
      RETURN;
    END IF;
    v_next_end := (v_next_start + INTERVAL '1 year')::date;

    IF EXISTS (SELECT 1 FROM fiscal_years fy WHERE fy.tenant_id = p_tenant_id AND fy.year_label = EXTRACT(YEAR FROM v_next_start)::text) THEN
      RETURN QUERY SELECT v_seq, 'refuse', v_cal.id, EXTRACT(YEAR FROM v_next_start)::text, v_next_start, v_next_end,
        'a fiscal year with this label already exists but does not continue the calendar';
      RETURN;
    END IF;

    RETURN QUERY SELECT v_seq, 'create', v_cal.id, EXTRACT(YEAR FROM v_next_start)::text, v_next_start, v_next_end,
      '12 monthly periods, status open';
    v_next_start := v_next_end;
  END LOOP;

  IF v_seq = 0 THEN
    RETURN QUERY SELECT 1, 'covered', v_cal.id, NULL::text, NULL::date, v_last_end, 'nothing to create';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ensure: dry-run by DEFAULT. Real generation only with p_dry_run => false.
--    Serialised per tenant (advisory transaction lock) so concurrent callers cannot
--    duplicate or interleave; the plan is computed AFTER the lock is held.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ensure_fiscal_years(
  p_tenant_id    UUID,
  p_through_date DATE,
  p_dry_run      BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  seq          INTEGER,
  action       TEXT,
  year_label   TEXT,
  start_date   DATE,
  end_date     DATE,
  created      BOOLEAN,
  detail       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_plan RECORD;
  v_refusal TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-years:' || p_tenant_id::text, 0));

  SELECT detail INTO v_refusal FROM fn_plan_fiscal_years(p_tenant_id, p_through_date) WHERE action = 'refuse' LIMIT 1;

  IF NOT p_dry_run AND v_refusal IS NOT NULL THEN
    RAISE EXCEPTION 'Fiscal year generation refused for tenant %: %', p_tenant_id, v_refusal
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_plan IN SELECT * FROM fn_plan_fiscal_years(p_tenant_id, p_through_date) ORDER BY seq LOOP
    IF v_plan.action = 'create' AND NOT p_dry_run THEN
      PERFORM fn_generate_fiscal_year(p_tenant_id, v_plan.fiscal_calendar_id, EXTRACT(YEAR FROM v_plan.start_date)::int, v_plan.year_label);
      RETURN QUERY SELECT v_plan.seq, v_plan.action, v_plan.year_label, v_plan.start_date, v_plan.end_date, TRUE, v_plan.detail;
    ELSE
      RETURN QUERY SELECT v_plan.seq, v_plan.action, v_plan.year_label, v_plan.start_date, v_plan.end_date, FALSE, v_plan.detail;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Safety net used by the posting engine (migration 326, separate approval):
--    extend by at most ONE contiguous year, only for a date adjacent to existing coverage.
--    Returns TRUE if it created a year. Never raises for "cannot extend" (returns FALSE) so
--    the engine keeps raising its own, unchanged, error message in that case.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_try_extend_fiscal_year(p_tenant_id UUID, p_posting_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_end DATE;
  v_created  INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-years:' || p_tenant_id::text, 0));

  -- already covered (another session may have just created it): nothing to do
  IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.tenant_id = p_tenant_id AND daterange(fp.start_date, fp.end_date, '[)') @> p_posting_date
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT max(end_date) INTO v_last_end FROM fiscal_years WHERE tenant_id = p_tenant_id;
  IF v_last_end IS NULL THEN RETURN FALSE; END IF;

  -- only the year directly after the last one, and never a far-future date
  IF p_posting_date < v_last_end OR p_posting_date >= (v_last_end + INTERVAL '1 year')::date THEN
    RETURN FALSE;
  END IF;
  IF p_posting_date > (CURRENT_DATE + INTERVAL '1 year')::date THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (SELECT 1 FROM fn_plan_fiscal_years(p_tenant_id, p_posting_date) WHERE action = 'refuse') THEN
    RETURN FALSE;
  END IF;

  -- Nested block = sub-transaction: if generation fails for ANY reason (constraint conflict, bad
  -- calendar data, ...) its partial inserts are rolled back and the caller (the posting engine)
  -- simply keeps raising its own unchanged 'No fiscal period covers posting date' error.
  BEGIN
    SELECT count(*) INTO v_created
    FROM fn_ensure_fiscal_years(p_tenant_id, p_posting_date, FALSE) e WHERE e.created;
    RETURN v_created > 0;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_try_extend_fiscal_year: could not extend fiscal years for tenant % to %: % (%)',
      p_tenant_id, p_posting_date, SQLERRM, SQLSTATE;
    RETURN FALSE;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Early warning: tenants whose coverage is below a threshold (default 180 days)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fiscal_coverage_alerts(p_threshold_days INTEGER DEFAULT 180)
RETURNS TABLE (tenant_id UUID, covered_until DATE, days_remaining INTEGER, severity TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.tenant_id, c.covered_until, c.days_remaining::int,
         CASE WHEN c.days_remaining < 0   THEN 'expired'
              WHEN c.days_remaining <= 30 THEN 'critical'
              WHEN c.days_remaining <= 90 THEN 'high'
              ELSE 'warning' END
  FROM v_fiscal_coverage c
  WHERE c.days_remaining < p_threshold_days
  ORDER BY c.days_remaining ASC, c.tenant_id
$$;

-- Supabase default privileges grant new objects to anon/authenticated: lock everything down.
REVOKE ALL ON v_fiscal_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_fiscal_coverage TO service_role;
REVOKE ALL ON FUNCTION fn_tenant_posting_date(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_plan_fiscal_years(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_ensure_fiscal_years(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_try_extend_fiscal_year(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_fiscal_coverage_alerts(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_tenant_posting_date(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION fn_plan_fiscal_years(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fn_ensure_fiscal_years(UUID, DATE, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION fn_try_extend_fiscal_year(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fn_fiscal_coverage_alerts(INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- ROLLBACK (documented AND exercised locally). Drops only what this file created; every
-- fiscal year/period already generated is append-only and REMAINS (see the incident path in
-- the WP-B report: it needs explicit approval and a backup).
--   DROP FUNCTION IF EXISTS fn_fiscal_coverage_alerts(INTEGER);
--   DROP FUNCTION IF EXISTS fn_try_extend_fiscal_year(UUID, DATE);
--   DROP FUNCTION IF EXISTS fn_ensure_fiscal_years(UUID, DATE, BOOLEAN);
--   DROP FUNCTION IF EXISTS fn_plan_fiscal_years(UUID, DATE);
--   DROP VIEW IF EXISTS v_fiscal_coverage;
--   DROP FUNCTION IF EXISTS fn_tenant_posting_date(UUID, TIMESTAMPTZ);
-- ---------------------------------------------------------------------------
