-- =============================================================================
-- 081 — RLS policies, session-context path: expenses/shifts/notifications/audit
-- =============================================================================
-- Same template as preceding migrations in this series. notifications and
-- audit_logs have a nullable tenant_id (system-level rows use NULL) — under
-- this policy those rows simply won't match any tenant session, which is
-- correct: system/superadmin-scoped rows aren't meant to be tenant-visible
-- through this path (superadmin access already goes through SuperAdminGuard,
-- not TenantSessionService — see STATUS.md §83).
-- =============================================================================

CREATE POLICY tenant_session_isolation ON expense_templates
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON expenses
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON shifts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON notifications
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON audit_logs
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
