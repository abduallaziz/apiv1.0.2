-- Migration 13.21 Phase 4 fix — scanner_events.session_id was declared
-- NOT NULL in migration 172 (before the Event Engine's actual ingestion
-- design was worked out). A scan legitimately arrives with no active
-- workflow session (e.g. an ad-hoc lookup scan, or a device polling
-- outside any Receiving/Picking/etc. session) — the DTO and service layer
-- (Phase 4) already treat session_id as optional; the schema must match.
-- Caught by this phase's own integration tests before merge, not after —
-- same discipline as every other schema/code mismatch found this session.
ALTER TABLE scanner_events ALTER COLUMN session_id DROP NOT NULL;

-- Rollback (documented, not auto-executed):
-- ALTER TABLE scanner_events ALTER COLUMN session_id SET NOT NULL;
-- (only safe if no session_id IS NULL rows exist)
