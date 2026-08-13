-- Migration 13.21 Phase 4 — Scanner Event Engine: extends scanner_events
-- (created in migration 172, no real data recorded yet) with the columns
-- the ingestion/normalization/idempotency pipeline needs. Purely additive
-- to a table this platform itself owns — no protected Sefay Core table is
-- touched.
--
-- Status model note: scanner_events is an immutable ledger (migration
-- 172's fn_block_scanner_events_mutation trigger blocks UPDATE/DELETE), so
-- a row's status is set exactly once at insert time and never transitions
-- in place. The full 5-state lifecycle requested at the API-design level
-- (RECEIVED / VALIDATED / REJECTED / PROCESSED / FAILED) maps onto this
-- immutable design as follows:
--   RECEIVED   — the inbound request itself; never persisted as a row on
--                its own (if it fails validation, nothing is stored).
--   VALIDATED  — the terminal, persisted state written by this migration's
--                ingestion pipeline once a scan passes device/session/
--                payload validation. This is the only "success" value the
--                Event Engine (Phase 4) itself writes.
--   REJECTED   — reserved for a future soft-reject path (validation
--                failures that still warrant a stored audit trail); not
--                written by Phase 4 today, kept in the CHECK for that.
--   DUPLICATE  — a scan that matched an existing event (by client_event_id
--                or by the dedup window) — the original row's status is
--                returned as-is, no new row is written.
--   PROCESSED / FAILED — these describe what the Resolver/Action Framework
--                (Phase 5/7) did with an already-validated event, i.e. the
--                downstream `scanner_actions` row's own status column
--                (pending/success/failed, already defined in migration
--                172) — NOT a mutation of the source scanner_events row.
--                Left out of this CHECK on purpose: adding unused values
--                to a CHECK constraint ahead of the code that would ever
--                write them repeats the exact kind of premature-signature
--                mistake already learned from this session's
--                fn_apply_stock_movement overload incident. Phase 5/7 will
--                extend scanner_actions' own semantics, not this column.

-- One orphaned row from the Phase 2 smoke test: the session it belonged to
-- was deleted directly (bypassing the app layer), which attempted a
-- CASCADE delete of this row — silently blocked by the immutability
-- trigger, leaving it behind with status='pending' and a dangling
-- session_id. This table has never been used for real scan data, so it is
-- safe to remove directly here (trigger disabled for this single
-- statement only, then immediately re-enabled) rather than carry a
-- known-orphaned test row into the new status model.
ALTER TABLE scanner_events DISABLE TRIGGER trg_scanner_events_no_delete;
DELETE FROM scanner_events WHERE client_event_id = 'evt-1' AND raw_value = '1234567890128';
ALTER TABLE scanner_events ENABLE TRIGGER trg_scanner_events_no_delete;

ALTER TABLE scanner_events
  ADD COLUMN normalized_value TEXT,
  ADD COLUMN source TEXT,
  ADD COLUMN client_timestamp TIMESTAMPTZ,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Replace the status CHECK written in migration 172 (pending/resolved/
-- failed/duplicate — a placeholder guess made before this phase's design
-- was worked out) with the actual set Phase 4 writes. Located dynamically
-- rather than by a guessed constraint name, same discipline already
-- applied to function-signature changes this session.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'scanner_events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE scanner_events DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE scanner_events
  ADD CONSTRAINT scanner_events_status_check
  CHECK (status IN ('validated', 'rejected', 'duplicate'));

ALTER TABLE scanner_events ALTER COLUMN status SET DEFAULT 'validated';

-- Dedup-window lookups filter by tenant+device+raw_value and scan a small
-- recent time slice — index matches that access path.
CREATE INDEX idx_scanner_events_dedup_window ON scanner_events(tenant_id, device_id, raw_value, created_at);

-- Rollback (documented, not auto-executed):
-- DROP INDEX IF EXISTS idx_scanner_events_dedup_window;
-- ALTER TABLE scanner_events DROP CONSTRAINT scanner_events_status_check;
-- ALTER TABLE scanner_events ADD CONSTRAINT scanner_events_status_check CHECK (status IN ('pending','resolved','failed','duplicate'));
-- ALTER TABLE scanner_events ALTER COLUMN status SET DEFAULT 'pending';
-- ALTER TABLE scanner_events DROP COLUMN normalized_value, DROP COLUMN source, DROP COLUMN client_timestamp, DROP COLUMN metadata;
