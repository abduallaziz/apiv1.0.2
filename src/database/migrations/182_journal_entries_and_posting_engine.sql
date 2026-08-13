-- Sefay Global Financial Platform — Migration M182
-- Journal Entry + Journal Line + database-level Posting Engine, per the
-- Final Pre-Implementation Correction §3: double-entry integrity is
-- enforced by the DATABASE, not application code. The only sanctioned
-- path to `status = 'posted'` is `fn_post_journal_entry()`; the only
-- sanctioned path to `status = 'reversed'` is `fn_reverse_journal_
-- entry()`. Every other UPDATE attempt at those transitions is rejected
-- by a guard trigger, regardless of which role or code path attempts it.
--
-- Scope, exactly as approved:
--   - journal_entries + journal_lines ONLY.
--   - Draft entries are freely editable (header and lines).
--   - Posting is atomic, verifies balance/accounts/book/period/period-
--     status/tenant ownership, and is the sole path to `posted`.
--   - Posted entries and their lines are immutable — DELETE blocked,
--     UPDATE blocked (except the single reversal-transition column).
--   - Correction is exclusively a new Reversal Journal Entry, itself
--     created and posted through the same posting engine — never an
--     UPDATE/DELETE of the original.
--
-- NOT in scope here: no Ledger table (retired as a concept — see M177
-- history), no AR/AP/Cash/Tax/Inventory Accounting integration, no
-- Dimensions. No M183 or later object is created. Inventory/WMS is
-- completely untouched.

-- ============================================================
-- journal_entries — header
-- ============================================================
CREATE TABLE journal_entries (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  accounting_book_id  UUID        NOT NULL,
  fiscal_period_id    UUID,
  posting_date        DATE        NOT NULL,
  document_date       DATE,
  reference           TEXT,
  description         TEXT,
  source_module       TEXT,
  source_entity_type  TEXT,
  source_entity_id    UUID,
  status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  reversal_of_id      UUID,
  created_by          UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_by           UUID        REFERENCES users(id),
  posted_at           TIMESTAMPTZ,
  reversed_by         UUID        REFERENCES users(id),
  reversed_at         TIMESTAMPTZ,

  -- Composite, tenant-safe FKs — the proven mechanism used throughout
  -- this Accounting Foundation.
  CONSTRAINT fk_journal_entries_book
    FOREIGN KEY (tenant_id, accounting_book_id) REFERENCES accounting_books (tenant_id, id),
  CONSTRAINT fk_journal_entries_period
    FOREIGN KEY (tenant_id, fiscal_period_id) REFERENCES fiscal_periods (tenant_id, id),
  CONSTRAINT fk_journal_entries_reversal_of
    FOREIGN KEY (tenant_id, reversal_of_id) REFERENCES journal_entries (tenant_id, id),
  CONSTRAINT fk_journal_entries_source
    FOREIGN KEY (source_module, source_entity_type) REFERENCES financial_event_source_types (source_module, source_entity_type),

  -- source_module/source_entity_type are paired — both present (an
  -- integration-originated entry) or both absent (a manual entry).
  CONSTRAINT chk_journal_entries_source_paired
    CHECK ((source_module IS NULL) = (source_entity_type IS NULL)),

  -- Tenant-safe composite-FK target for journal_lines.
  CONSTRAINT uq_journal_entries_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_journal_entries_tenant_book ON journal_entries(tenant_id, accounting_book_id);
CREATE INDEX idx_journal_entries_tenant_period ON journal_entries(tenant_id, fiscal_period_id);
CREATE INDEX idx_journal_entries_tenant_status ON journal_entries(tenant_id, status);
CREATE INDEX idx_journal_entries_tenant_source ON journal_entries(tenant_id, source_module, source_entity_type, source_entity_id);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON journal_entries
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.journal_entries TO service_role;

-- ============================================================
-- journal_lines — detail
-- ============================================================
CREATE TABLE journal_lines (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_entry_id  UUID          NOT NULL,
  line_number       INTEGER       NOT NULL,
  account_id        UUID          NOT NULL,
  debit_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  description       TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- A line is either a debit line or a credit line, never both, and
  -- never neither (no zero-amount lines).
  CONSTRAINT chk_journal_lines_single_side
    CHECK (debit_amount = 0 OR credit_amount = 0),
  CONSTRAINT chk_journal_lines_nonzero
    CHECK (debit_amount > 0 OR credit_amount > 0),

  CONSTRAINT fk_journal_lines_entry
    FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries (tenant_id, id),
  CONSTRAINT fk_journal_lines_account
    FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),

  CONSTRAINT uq_journal_lines_entry_line_number UNIQUE (tenant_id, journal_entry_id, line_number)
);

CREATE INDEX idx_journal_lines_tenant_entry ON journal_lines(tenant_id, journal_entry_id);
CREATE INDEX idx_journal_lines_tenant_account ON journal_lines(tenant_id, account_id);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON journal_lines
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.journal_lines TO service_role;

-- ============================================================
-- Guard trigger — journal_entries. This is what makes `fn_post_journal_
-- entry` and `fn_reverse_journal_entry` the ONLY sanctioned paths to
-- their respective status transitions: a transaction-local GUC flag,
-- set only inside those functions, is required for the transition to
-- be accepted at all. Any direct `UPDATE journal_entries SET
-- status='posted'` from anywhere else is rejected.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_guard_journal_entries_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft journal entries can be deleted (entry % has status %)', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'draft' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'posted' THEN
          IF coalesce(current_setting('sefay.posting_engine_active', true), 'false') <> 'true' THEN
            RAISE EXCEPTION 'Journal entries can only transition to posted via fn_post_journal_entry()';
          END IF;
        ELSE
          RAISE EXCEPTION 'Invalid status transition from draft to %', NEW.status;
        END IF;
      END IF;
      RETURN NEW; -- draft entries are otherwise freely editable
    ELSIF OLD.status = 'posted' THEN
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.accounting_book_id IS DISTINCT FROM OLD.accounting_book_id
         OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id
         OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
         OR NEW.reference IS DISTINCT FROM OLD.reference
         OR NEW.description IS DISTINCT FROM OLD.description
         OR NEW.source_module IS DISTINCT FROM OLD.source_module
         OR NEW.source_entity_type IS DISTINCT FROM OLD.source_entity_type
         OR NEW.source_entity_id IS DISTINCT FROM OLD.source_entity_id
         OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
         OR NEW.posted_at IS DISTINCT FROM OLD.posted_at THEN
        RAISE EXCEPTION 'Posted journal entries are immutable except for the reversal transition';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status <> 'reversed' OR coalesce(current_setting('sefay.reversal_engine_active', true), 'false') <> 'true' THEN
          RAISE EXCEPTION 'Posted journal entries can only transition to reversed via fn_reverse_journal_entry()';
        END IF;
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'Reversed journal entries are permanently immutable';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entries_guard
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_guard_journal_entries_mutation();

-- ============================================================
-- Guard trigger — journal_lines. Lines can only be inserted/updated/
-- deleted while their PARENT entry is still 'draft'. Once the parent is
-- posted or reversed, its lines are completely frozen — this closes the
-- bypass where someone could leave the header alone but still tamper
-- with a posted entry's lines directly.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_guard_journal_lines_mutation() RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_entry_id UUID;
BEGIN
  v_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;

  SELECT status INTO v_status FROM journal_entries WHERE id = v_entry_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Parent journal entry % not found', v_entry_id;
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot modify lines of a non-draft journal entry (status=%). Corrections must use a reversal entry.', v_status;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_guard
BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_guard_journal_lines_mutation();

-- ============================================================
-- fn_post_journal_entry — the SOLE sanctioned path to `status =
-- 'posted'`. SECURITY DEFINER, single transaction, locks the entry row
-- first (protecting against concurrent double-posting), verifies every
-- required invariant, then atomically transitions the entry.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_post_journal_entry(
  p_tenant_id UUID,
  p_entry_id UUID,
  p_posted_by UUID
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status          TEXT;
  v_book_id         UUID;
  v_posting_date    DATE;
  v_book_status     TEXT;
  v_line_count      INTEGER;
  v_total_debit     NUMERIC(14,2);
  v_total_credit    NUMERIC(14,2);
  v_bad_account_id  UUID;
  v_period_id       UUID;
  v_period_status   TEXT;
BEGIN
  -- Lock the entry row first — a concurrent second call for the same
  -- entry blocks here until this transaction commits or rolls back,
  -- then observes status <> 'draft' and is rejected below.
  SELECT status, accounting_book_id, posting_date
    INTO v_status, v_book_id, v_posting_date
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found for tenant %', p_entry_id, p_tenant_id;
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Journal entry % is not in draft status (current status: %) and cannot be posted', p_entry_id, v_status;
  END IF;

  -- Minimum valid lines: double-entry requires at least 2 lines.
  SELECT count(*), coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
    INTO v_line_count, v_total_debit, v_total_credit
  FROM journal_lines
  WHERE journal_entry_id = p_entry_id AND tenant_id = p_tenant_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % has fewer than 2 lines — a journal entry requires at least one debit and one credit line', p_entry_id;
  END IF;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry % is not balanced: total debit % <> total credit %', p_entry_id, v_total_debit, v_total_credit;
  END IF;

  -- Every referenced account must exist, belong to this tenant, be
  -- active, and be a posting account (not a header/parent account).
  SELECT jl.account_id INTO v_bad_account_id
  FROM journal_lines jl
  LEFT JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = p_tenant_id
  WHERE jl.journal_entry_id = p_entry_id AND jl.tenant_id = p_tenant_id
    AND (a.id IS NULL OR a.is_active = false OR a.is_posting_account = false)
  LIMIT 1;

  IF v_bad_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Journal entry % references an invalid, inactive, or non-posting account %', p_entry_id, v_bad_account_id;
  END IF;

  -- Accounting Book must exist for this tenant and be active. (Its
  -- Accounting Owner/tenant consistency was already guaranteed at
  -- insert time by accounting_books' own composite FK — re-verified
  -- here only for current active status, which can change after the
  -- entry was drafted.)
  SELECT status INTO v_book_status
  FROM accounting_books
  WHERE id = v_book_id AND tenant_id = p_tenant_id;

  IF v_book_status IS NULL THEN
    RAISE EXCEPTION 'Accounting Book % not found for tenant %', v_book_id, p_tenant_id;
  END IF;

  IF v_book_status <> 'active' THEN
    RAISE EXCEPTION 'Accounting Book % is not active and cannot receive postings', v_book_id;
  END IF;

  -- Resolve the Fiscal Period from posting_date and verify it is open.
  SELECT id, status INTO v_period_id, v_period_status
  FROM fiscal_periods
  WHERE tenant_id = p_tenant_id
    AND daterange(start_date, end_date, '[)') @> v_posting_date;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No fiscal period covers posting date % for tenant %', v_posting_date, p_tenant_id;
  END IF;

  IF v_period_status <> 'open' THEN
    RAISE EXCEPTION 'Fiscal period % (status=%) is not open — journal entry % cannot be posted into a closed or locked period', v_period_id, v_period_status, p_entry_id;
  END IF;

  -- All invariants hold — atomically transition to posted. The GUC flag
  -- is what the guard trigger checks to accept this specific UPDATE.
  PERFORM set_config('sefay.posting_engine_active', 'true', true);

  UPDATE journal_entries
  SET status = 'posted',
      fiscal_period_id = v_period_id,
      posted_by = p_posted_by,
      posted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;

  PERFORM set_config('sefay.posting_engine_active', 'false', true);

  RETURN p_entry_id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fn_post_journal_entry(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_post_journal_entry(UUID, UUID, UUID) TO service_role;

-- ============================================================
-- fn_reverse_journal_entry — the SOLE correction mechanism for a posted
-- entry. Creates a new Journal Entry with debit/credit swapped on every
-- line, posts it through the SAME posting engine above (so the
-- reversal itself is validated by every invariant a normal entry is),
-- then marks the original as reversed via the reversal GUC flag.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_reverse_journal_entry(
  p_tenant_id UUID,
  p_entry_id UUID,
  p_reversed_by UUID,
  p_posting_date DATE,
  p_reason TEXT
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original RECORD;
  v_new_entry_id UUID;
  v_already_reversed BOOLEAN;
BEGIN
  SELECT * INTO v_original
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found for tenant %', p_entry_id, p_tenant_id;
  END IF;

  IF v_original.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted journal entries can be reversed (entry % has status %)', p_entry_id, v_original.status;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM journal_entries WHERE reversal_of_id = p_entry_id AND tenant_id = p_tenant_id
  ) INTO v_already_reversed;

  IF v_already_reversed THEN
    RAISE EXCEPTION 'Journal entry % has already been reversed', p_entry_id;
  END IF;

  INSERT INTO journal_entries (
    tenant_id, accounting_book_id, posting_date, document_date, reference,
    description, source_module, source_entity_type, source_entity_id,
    reversal_of_id, created_by
  ) VALUES (
    p_tenant_id, v_original.accounting_book_id, p_posting_date, p_posting_date,
    'Reversal of ' || coalesce(v_original.reference, v_original.id::text),
    coalesce(p_reason, 'Reversal of journal entry ' || v_original.id::text),
    v_original.source_module, v_original.source_entity_type, v_original.source_entity_id,
    p_entry_id, p_reversed_by
  ) RETURNING id INTO v_new_entry_id;

  INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount, description)
  SELECT tenant_id, v_new_entry_id, line_number, account_id, credit_amount, debit_amount, description
  FROM journal_lines
  WHERE journal_entry_id = p_entry_id AND tenant_id = p_tenant_id;

  -- Post the reversal entry through the same sanctioned posting engine.
  PERFORM fn_post_journal_entry(p_tenant_id, v_new_entry_id, p_reversed_by);

  PERFORM set_config('sefay.reversal_engine_active', 'true', true);

  UPDATE journal_entries
  SET status = 'reversed',
      reversed_by = p_reversed_by,
      reversed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;

  PERFORM set_config('sefay.reversal_engine_active', 'false', true);

  RETURN v_new_entry_id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fn_reverse_journal_entry(UUID, UUID, UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_reverse_journal_entry(UUID, UUID, UUID, DATE, TEXT) TO service_role;

-- No seed data, no backfill. Inventory/WMS is completely untouched.

-- Rollback (documented, not auto-executed):
-- REVOKE EXECUTE ON FUNCTION fn_reverse_journal_entry(UUID, UUID, UUID, DATE, TEXT) FROM service_role;
-- DROP FUNCTION IF EXISTS fn_reverse_journal_entry(UUID, UUID, UUID, DATE, TEXT);
-- REVOKE EXECUTE ON FUNCTION fn_post_journal_entry(UUID, UUID, UUID) FROM service_role;
-- DROP FUNCTION IF EXISTS fn_post_journal_entry(UUID, UUID, UUID);
-- DROP TRIGGER IF EXISTS trg_journal_lines_guard ON journal_lines;
-- DROP FUNCTION IF EXISTS fn_guard_journal_lines_mutation();
-- DROP TRIGGER IF EXISTS trg_journal_entries_guard ON journal_entries;
-- DROP FUNCTION IF EXISTS fn_guard_journal_entries_mutation();
-- DROP TABLE IF EXISTS journal_lines;
-- DROP TABLE IF EXISTS journal_entries;
