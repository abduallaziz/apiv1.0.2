-- =============================================================================
-- 082 — Enable RLS + policy, HR tables (bundled, not two separate steps)
-- =============================================================================
-- These 7 tables never had RLS enabled at all (distinct from 075-081, which
-- added policies to tables that already had RLS ON with zero policy). Verified
-- before writing this: none of them are in the `supabase_realtime` publication
-- (only `tables`/`orders`/`order_items` are — checked 073/074 and
-- web/src/core/realtime/RealtimeProvider.tsx directly) and nothing in this
-- codebase queries them via a role other than SUPABASE_SERVICE_ROLE_KEY (which
-- bypasses RLS regardless). So enabling RLS here, bundled with its policy in
-- the same migration, has zero observable effect until a repository migrates
-- onto TenantSessionService's pooled/session-scoped connection — same
-- eventual-enforcement model as 075-081.
-- =============================================================================

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON attendance_records
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON attendance_exceptions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON work_schedules
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE shift_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON shift_patterns
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON leave_requests
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON departments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE employee_geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON employee_geofences
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
