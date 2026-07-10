-- =============================================================================
-- 084 — Enable RLS + policy, dine-in tables (bundled)
-- =============================================================================
-- Same verification as 082/083: not realtime-published, not queried outside
-- SUPABASE_SERVICE_ROLE_KEY today. Note `tables` itself (the dine-in table
-- entity, not this migrations table) already has RLS + a realtime-JWT policy
-- from 073/074 — unaffected by this migration, listed here only for context.
-- =============================================================================

ALTER TABLE table_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON table_reservations
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON waitlist_entries
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
