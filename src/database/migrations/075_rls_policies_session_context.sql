-- =============================================================================
-- 075 — RLS policies for the pooled-session tenant context (SET LOCAL app.tenant_id)
-- =============================================================================
-- Companion to `api/src/core/tenant/tenant-session.service.ts`. These policies
-- are additive alongside the existing JWT-based Realtime policies from
-- 073/074 (Postgres combines multiple permissive policies with OR) — they do
-- not replace them.
--
-- NOTE: these policies are inert for any query still made via
-- SUPABASE_SERVICE_ROLE_KEY (supabase.module.ts) — that role bypasses RLS
-- regardless of what's defined here. They only take effect once a repository
-- has migrated onto PgPoolModule + TenantSessionService, so app.tenant_id is
-- actually set on the connection running the query.
--
-- First tranche only — customers, orders/order_items, invoices/invoice_items,
-- payments. Remaining tenant-scoped tables follow the same template as their
-- repositories migrate onto the pooled session in later migrations.
-- =============================================================================

CREATE POLICY tenant_session_isolation ON customers
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON order_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY tenant_session_isolation ON invoices
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON invoice_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY tenant_session_isolation ON payments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
