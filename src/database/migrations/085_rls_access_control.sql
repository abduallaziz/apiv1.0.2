-- =============================================================================
-- 085 — Enable RLS + policy, access-control tables (bundled) + documented
-- exclusions for the global RBAC catalogs
-- =============================================================================
-- This group backs the exact subsystem behind the privilege-escalation bug
-- fixed in STATUS.md §83 (AnalyticsController/AuditLogsController +
-- AccessControlService.assertPermissionIsCustomizable). RLS here is
-- defense-in-depth for `tenant_role_permissions` — it does not by itself
-- close that bug (SuperAdminGuard on the two controllers is what closed it);
-- it stops one tenant's override rows from being readable/writable by another
-- tenant once any repository in this area migrates onto the pooled/session
-- connection.
-- =============================================================================

-- `roles` is dual-purpose: system roles have tenant_id IS NULL (is_system =
-- true, e.g. owner/manager/cashier), tenant-custom roles have tenant_id set.
-- A plain tenant_id = current_setting(...) policy would hide every system
-- role from every tenant session. This mirrors the exact check application
-- code already performs in AccessControlService.getAccessibleRoleOrThrow().
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON roles
  FOR ALL
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

ALTER TABLE tenant_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON tenant_role_permissions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =============================================================================
-- Deliberately excluded — global catalogs, no tenant_id column on any of
-- them (verified directly against their CREATE TABLE definitions, not
-- assumed). A tenant-scoped policy against these would be invalid SQL, not
-- just unnecessary:
--   - permissions           (global permission-key catalog)
--   - permission_groups     (global UI grouping for the catalog above)
--   - role_permissions      (global default role-name -> permission mapping)
--   - plans                 (global SaaS pricing-tier catalog)
-- Same category as features/plan_features excluded in 084 (STATUS.md §84).
-- =============================================================================
