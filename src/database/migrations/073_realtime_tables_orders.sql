-- Enables Supabase Realtime (Postgres Changes) push for the tables/kitchen/POS
-- live-update requirement, replacing the interim polling added in the web repo.
--
-- The app's own JWT (issued by NestJS, JWT_SECRET) is now also the Supabase
-- project's configured JWT secret (set via Management API — Supabase Auth itself
-- is unused: 0 rows in auth.users, no storage buckets, no existing RLS policy
-- anywhere referenced auth.*, confirmed before this change). That means
-- auth.jwt() in RLS policies below correctly reads our own custom claims
-- (tenant_id, sub, role) for any request/socket authenticated with our token —
-- no separate Supabase Auth session needed.
--
-- service_role (used by every existing NestJS Supabase call) has BYPASSRLS by
-- default, so none of this affects any current backend read/write path — these
-- policies only ever apply to the browser's anon-key Realtime subscription.

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- RLS policies only decide WHICH rows a role can see — the role still needs the
-- base table-level privilege to read anything at all. anon is what the browser's
-- Realtime subscription authenticates as (via the publishable/anon key), so it
-- needs SELECT here or every RLS-approved row would still be invisible to it.
GRANT SELECT ON tables TO anon, authenticated;
GRANT SELECT ON orders TO anon, authenticated;
GRANT SELECT ON order_items TO anon, authenticated;

DROP POLICY IF EXISTS realtime_tenant_select ON tables;
CREATE POLICY realtime_tenant_select ON tables
  FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS realtime_tenant_select ON orders;
CREATE POLICY realtime_tenant_select ON orders
  FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- order_items has no tenant_id column of its own (established in dine-in.repository.ts) —
-- scoped via its parent order's tenant_id instead, same pattern used everywhere else
-- in this codebase for this exact table.
DROP POLICY IF EXISTS realtime_tenant_select ON order_items;
CREATE POLICY realtime_tenant_select ON order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- Adds these three tables to the publication Supabase Realtime streams Postgres
-- Changes from. Safe to re-run — guards against the table already being a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;
END $$;
