-- =============================================================================
-- 077 — RLS policies, session-context path: platform/tenant-core tables
-- =============================================================================
-- Same template as 075/076. Two tables here don't fit the standard
-- `tenant_id = current_setting(...)` shape and are handled explicitly:
--   - tenants: the tenant's own identity IS `id`, not a `tenant_id` FK.
--   - refresh_tokens: has no tenant_id column at all (only user_id/session_id)
--     — scoped via EXISTS through users, matching the pattern 075 already
--     used for order_items/invoice_items relating through their parent.
-- =============================================================================

CREATE POLICY tenant_session_isolation ON tenants
  FOR ALL
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON users
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON device_sessions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON refresh_tokens
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = refresh_tokens.user_id
        AND u.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = refresh_tokens.user_id
        AND u.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY tenant_session_isolation ON branches
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON subscriptions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON dunning_attempts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON tenant_feature_overrides
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON billing_customers
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
