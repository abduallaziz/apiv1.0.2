-- Migration 073's policies read auth.jwt() ->> 'tenant_id' (top-level claim), which
-- assumed a custom HS256-signed token with tenant_id at the root. The actual bridge
-- implemented instead uses genuine Supabase Auth sessions (minted server-side via
-- admin.createUser + generateLink/verifyOtp, tagged with app_metadata.tenant_id) so
-- the already-active ES256 signing key can be used with no key rotation at all.
-- Supabase automatically nests custom claims under app_metadata in every session
-- JWT, so the correct claim path is auth.jwt() -> 'app_metadata' ->> 'tenant_id'.
-- Verified end-to-end with a real minted session before/after this fix (071's
-- policies returned 0 rows for a real tenant with data; this version returns them).

DROP POLICY IF EXISTS realtime_tenant_select ON tables;
CREATE POLICY realtime_tenant_select ON tables
  FOR SELECT
  USING (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS realtime_tenant_select ON orders;
CREATE POLICY realtime_tenant_select ON orders
  FOR SELECT
  USING (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS realtime_tenant_select ON order_items;
CREATE POLICY realtime_tenant_select ON order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid
    )
  );
