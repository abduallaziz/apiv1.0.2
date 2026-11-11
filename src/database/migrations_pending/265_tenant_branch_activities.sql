-- 265_tenant_branch_activities.sql   (PENDING — not applied, not yet verified on a database)
-- P2: several activities per tenant and activity(ies) per branch. Depends on 264.
-- tenants.activity is KEPT (dual-write by the app) so existing web/Android/JWT behaviour is unchanged.
-- Resolution rule: a branch with no branch_activities rows inherits its tenant's activities.
-- Follows the new-table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.

CREATE TABLE IF NOT EXISTS tenant_activities (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_code    TEXT        NOT NULL REFERENCES activity_definitions(code),
  is_primary       BOOLEAN     NOT NULL DEFAULT FALSE,
  config_overrides JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT tenant_activities_overrides_is_object CHECK (jsonb_typeof(config_overrides) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_activities_active
  ON tenant_activities (tenant_id, activity_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_activities_one_primary
  ON tenant_activities (tenant_id) WHERE is_primary AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS branch_activities (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  activity_code    TEXT        NOT NULL REFERENCES activity_definitions(code),
  is_default       BOOLEAN     NOT NULL DEFAULT FALSE,
  config_overrides JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT branch_activities_overrides_is_object CHECK (jsonb_typeof(config_overrides) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_activities_active
  ON branch_activities (branch_id, activity_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_activities_one_default
  ON branch_activities (branch_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_branch_activities_tenant ON branch_activities (tenant_id);

ALTER TABLE tenant_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_session_isolation ON tenant_activities;
CREATE POLICY tenant_session_isolation ON tenant_activities
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_session_isolation ON branch_activities;
CREATE POLICY tenant_session_isolation ON branch_activities
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.tenant_activities TO service_role;
GRANT ALL PRIVILEGES ON public.branch_activities TO service_role;

-- Backfill: one primary activity per tenant from the legacy column, only when the code is known.
-- Idempotent; tenants with NULL/unknown activity are left without rows (legacy fallback applies).
INSERT INTO tenant_activities (tenant_id, activity_code, is_primary)
SELECT t.id, t.activity, TRUE
  FROM tenants t
  JOIN activity_definitions d ON d.code = t.activity
 WHERE t.activity IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM tenant_activities ta
      WHERE ta.tenant_id = t.id AND ta.is_primary AND ta.deleted_at IS NULL
   )
ON CONFLICT DO NOTHING;

-- ROLLBACK: DROP TABLE IF EXISTS branch_activities; DROP TABLE IF EXISTS tenant_activities;
-- (tenants.activity is untouched, so nothing is lost)
