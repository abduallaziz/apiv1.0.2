-- =============================================================================
-- 022. OUTBOX CLAIM FUNCTION
-- Atomically claims a batch of pending/failed domain events for relay, using
-- SELECT ... FOR UPDATE SKIP LOCKED so multiple worker instances (horizontal
-- scaling) never double-claim the same row. This is the one part of outbox
-- relay that needs a true atomic primitive; marking processed/failed
-- afterwards is a single-row update against a row only this worker holds.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_claim_outbox_events(
  p_limit       INTEGER,
  p_max_retries INTEGER DEFAULT 10
) RETURNS SETOF domain_events_outbox AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM domain_events_outbox
     WHERE status IN ('pending', 'failed')
       AND retry_count < p_max_retries
     ORDER BY created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE domain_events_outbox o
     SET status = 'processing'
    FROM claimed c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$ LANGUAGE plpgsql;
