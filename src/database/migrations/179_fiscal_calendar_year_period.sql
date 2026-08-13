-- Sefay Global Financial Platform — Migration M179
-- Fiscal Calendar + Fiscal Year + Fiscal Period — the Foundation that
-- defines how Sefay understands accounting time, per the Final
-- Pre-Implementation Correction (§2, Fiscal Calendar Evolution).
--
-- Core guarantee: current fiscal-calendar configuration can NEVER
-- reinterpret historical Accounting. This is achieved by treating
-- Fiscal Year and Fiscal Period as GENERATED, IMMUTABLE FACTS:
--   - fiscal_calendars is versioned and effective-dated (same
--     effective-dating + exclusion-constraint mechanism already proven
--     in Branch Accounting Assignment History, M178) — a Tenant may
--     change its fiscal-year start month/day going forward at any time.
--   - fiscal_years and fiscal_periods are GENERATED once, from whichever
--     Calendar version was in effect at generation time, and their
--     concrete start_date/end_date are written directly onto the row.
--     After generation, a row's dates are NEVER re-derived from the
--     Calendar again — they are frozen facts. Changing the Calendar
--     later only affects Fiscal Years generated AFTER that change.
--   - An already-generated Fiscal Year/Period can never be regenerated,
--     and its dates can never be UPDATEd (enforced by a guard trigger,
--     same immutable-ledger pattern used in M178/stock_movements/
--     scanner_events). Only `status` (open/closed/locked) may change —
--     a period's business closing state is not a historical fact about
--     when the period occurred, unlike its dates.
--
-- No Accounting Book, Chart of Accounts, or Journal object is created
-- here. No backfill, no seed data — Fiscal Calendars are created
-- on-demand when a tenant actually enables Accounting, per the same
-- "no blind pre-provisioning" rule already applied to Accounting Owners.
-- Inventory/WMS is untouched.

-- ============================================================
-- fiscal_calendars — versioned, effective-dated fiscal-year definition
-- ============================================================
CREATE TABLE fiscal_calendars (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_month    INTEGER     NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day      INTEGER     NOT NULL DEFAULT 1 CHECK (start_day BETWEEN 1 AND 28),
  effective_from DATE        NOT NULL,
  effective_to   DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fiscal_calendars_dates
    CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- Tenant-safe composite-FK target for fiscal_years' provenance FK.
  CONSTRAINT uq_fiscal_calendars_tenant_id UNIQUE (tenant_id, id)
);

-- start_day capped at 28 (not 31) deliberately: every calendar month has
-- at least 28 days, so a fiscal year can always start on this day
-- regardless of which start_month is chosen — avoids Feb 29/30/31
-- edge cases entirely, at the cost of not supporting "start on the last
-- day of the month" as a distinct option (not a current requirement).

-- No two calendar versions may be in effect for the same tenant at the
-- same time — same half-open-interval exclusion mechanism as M178.
ALTER TABLE fiscal_calendars
  ADD CONSTRAINT excl_fiscal_calendars_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

CREATE UNIQUE INDEX uq_fiscal_calendars_current ON fiscal_calendars(tenant_id) WHERE effective_to IS NULL;

ALTER TABLE fiscal_calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON fiscal_calendars
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.fiscal_calendars TO service_role;

-- Calendar versions are corrected forward (a new row + closing the old
-- one's effective_to), never deleted or rewritten once other Fiscal
-- Years may have been generated from them — enforced by the same
-- guard-trigger pattern as M178 (DELETE blocked; UPDATE blocked except
-- closing an open effective_to exactly once).
CREATE OR REPLACE FUNCTION fn_guard_fiscal_calendar_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal_calendars is an append-only historical record — rows cannot be deleted. Correct forward with a new calendar version instead.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.start_month IS DISTINCT FROM OLD.start_month
       OR NEW.start_day IS DISTINCT FROM OLD.start_day
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      RAISE EXCEPTION 'fiscal_calendars rows are immutable except for closing effective_to on a currently-open version';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
      RAISE EXCEPTION 'This calendar version is already closed (effective_to is set) and cannot be modified further';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_calendars_guard
BEFORE UPDATE OR DELETE ON fiscal_calendars
FOR EACH ROW EXECUTE FUNCTION fn_guard_fiscal_calendar_mutation();

-- ============================================================
-- fiscal_years — GENERATED, IMMUTABLE facts. start_date/end_date are
-- written once at generation time and never recomputed from the
-- calendar again. end_date is EXCLUSIVE (half-open range), consistent
-- with the daterange convention used throughout this project.
-- ============================================================
CREATE TABLE fiscal_years (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fiscal_calendar_id UUID        NOT NULL,
  year_label         TEXT        NOT NULL,
  start_date         DATE        NOT NULL,
  end_date           DATE        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fiscal_years_dates CHECK (end_date > start_date),

  -- Provenance: which calendar version generated this year — recorded
  -- for audit/traceability only. The row's own dates are authoritative
  -- and are never re-derived from this reference after insert.
  CONSTRAINT fk_fiscal_years_calendar
    FOREIGN KEY (tenant_id, fiscal_calendar_id) REFERENCES fiscal_calendars (tenant_id, id),

  CONSTRAINT uq_fiscal_years_tenant_label UNIQUE (tenant_id, year_label),

  -- Tenant-safe composite-FK target for fiscal_periods.
  CONSTRAINT uq_fiscal_years_tenant_id UNIQUE (tenant_id, id)
);

-- A tenant's fiscal years can never overlap each other in time.
ALTER TABLE fiscal_years
  ADD CONSTRAINT excl_fiscal_years_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  );

CREATE INDEX idx_fiscal_years_tenant ON fiscal_years(tenant_id);

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON fiscal_years
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.fiscal_years TO service_role;

-- Immutability: dates and calendar provenance are permanent facts once
-- generated; only `status` (the business closing state) may change.
-- DELETE is always blocked — a fiscal year, once generated, is
-- permanent history.
CREATE OR REPLACE FUNCTION fn_guard_fiscal_year_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal_years is an append-only generated record — rows cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.fiscal_calendar_id IS DISTINCT FROM OLD.fiscal_calendar_id
       OR NEW.year_label IS DISTINCT FROM OLD.year_label
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
      RAISE EXCEPTION 'fiscal_years dates/provenance are immutable once generated — only status may change';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_years_guard
BEFORE UPDATE OR DELETE ON fiscal_years
FOR EACH ROW EXECUTE FUNCTION fn_guard_fiscal_year_mutation();

-- ============================================================
-- fiscal_periods — GENERATED, IMMUTABLE facts, one per month within a
-- Fiscal Year (default granularity). Same immutability model as
-- fiscal_years: dates are permanent once generated, only status changes.
-- ============================================================
CREATE TABLE fiscal_periods (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fiscal_year_id UUID        NOT NULL,
  period_number  INTEGER     NOT NULL CHECK (period_number BETWEEN 1 AND 12),
  start_date     DATE        NOT NULL,
  end_date       DATE        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fiscal_periods_dates CHECK (end_date > start_date),

  CONSTRAINT fk_fiscal_periods_year
    FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fiscal_years (tenant_id, id),

  CONSTRAINT uq_fiscal_periods_year_number UNIQUE (tenant_id, fiscal_year_id, period_number),

  -- Tenant-safe composite-FK target for the future Journal Entry (M182),
  -- which will resolve its accounting period via this table.
  CONSTRAINT uq_fiscal_periods_tenant_id UNIQUE (tenant_id, id)
);

-- Periods can never overlap each other in time for a given tenant
-- (this transitively also prevents periods from different fiscal years
-- overlapping, since fiscal years themselves cannot overlap).
ALTER TABLE fiscal_periods
  ADD CONSTRAINT excl_fiscal_periods_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  );

CREATE INDEX idx_fiscal_periods_tenant_year ON fiscal_periods(tenant_id, fiscal_year_id);
-- Point-in-time "which period does this date fall into" is served by the
-- exclusion constraint's own implicit GiST index — no separate index
-- needed (same reasoning as M178).

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON fiscal_periods
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.fiscal_periods TO service_role;

CREATE OR REPLACE FUNCTION fn_guard_fiscal_period_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal_periods is an append-only generated record — rows cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id
       OR NEW.period_number IS DISTINCT FROM OLD.period_number
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
      RAISE EXCEPTION 'fiscal_periods dates are immutable once generated — only status may change';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_periods_guard
BEFORE UPDATE OR DELETE ON fiscal_periods
FOR EACH ROW EXECUTE FUNCTION fn_guard_fiscal_period_mutation();

-- ============================================================
-- fn_generate_fiscal_year — the sole sanctioned way to create a Fiscal
-- Year and its 12 monthly Fiscal Periods. Reads the given Calendar
-- version's start_month/start_day AT CALL TIME ONLY, computes concrete
-- dates, and writes them permanently — the Calendar is never consulted
-- again for this year/its periods after this call returns. Calling this
-- twice for the same tenant/year_label is rejected by
-- uq_fiscal_years_tenant_label, guaranteeing a Fiscal Year can never be
-- silently regenerated.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_generate_fiscal_year(
  p_tenant_id UUID,
  p_fiscal_calendar_id UUID,
  p_calendar_year INTEGER,
  p_year_label TEXT
) RETURNS UUID AS $$
DECLARE
  v_start_month INTEGER;
  v_start_day   INTEGER;
  v_start_date  DATE;
  v_end_date    DATE;
  v_fiscal_year_id UUID;
  v_period_start DATE;
  v_period_end   DATE;
  i INTEGER;
BEGIN
  SELECT start_month, start_day INTO v_start_month, v_start_day
  FROM fiscal_calendars
  WHERE id = p_fiscal_calendar_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_calendar % not found for tenant %', p_fiscal_calendar_id, p_tenant_id;
  END IF;

  v_start_date := make_date(p_calendar_year, v_start_month, v_start_day);
  v_end_date   := v_start_date + INTERVAL '1 year';

  INSERT INTO fiscal_years (tenant_id, fiscal_calendar_id, year_label, start_date, end_date)
  VALUES (p_tenant_id, p_fiscal_calendar_id, p_year_label, v_start_date, v_end_date)
  RETURNING id INTO v_fiscal_year_id;

  v_period_start := v_start_date;
  FOR i IN 1..12 LOOP
    v_period_end := v_period_start + INTERVAL '1 month';
    INSERT INTO fiscal_periods (tenant_id, fiscal_year_id, period_number, start_date, end_date)
    VALUES (p_tenant_id, v_fiscal_year_id, i, v_period_start, v_period_end);
    v_period_start := v_period_end;
  END LOOP;

  RETURN v_fiscal_year_id;
END;
$$ LANGUAGE plpgsql;

-- No seed data, no backfill: Fiscal Calendars/Years/Periods are created
-- on-demand when a tenant actually enables Accounting.

-- Rollback (documented, not auto-executed):
-- DROP FUNCTION IF EXISTS fn_generate_fiscal_year(UUID, UUID, INTEGER, TEXT);
-- DROP TRIGGER IF EXISTS trg_fiscal_periods_guard ON fiscal_periods;
-- DROP FUNCTION IF EXISTS fn_guard_fiscal_period_mutation();
-- DROP TABLE IF EXISTS fiscal_periods;
-- DROP TRIGGER IF EXISTS trg_fiscal_years_guard ON fiscal_years;
-- DROP FUNCTION IF EXISTS fn_guard_fiscal_year_mutation();
-- DROP TABLE IF EXISTS fiscal_years;
-- DROP TRIGGER IF EXISTS trg_fiscal_calendars_guard ON fiscal_calendars;
-- DROP FUNCTION IF EXISTS fn_guard_fiscal_calendar_mutation();
-- DROP TABLE IF EXISTS fiscal_calendars;
