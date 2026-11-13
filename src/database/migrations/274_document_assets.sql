-- Document Template Builder, Phase 1 (assets): the private stamp/signature/logo library.
-- Design: docs/DESIGN_DOCUMENT_BUILDER.md §3.4-3.6. Feature flag: DOCUMENTS_BUILDER_ENABLED.
-- Assets are NEVER public: storage_path points into StorageService's private bucket; access is
-- only ever through a short-lived signed URL generated server-side (no public URL column exists
-- here on purpose).
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP TABLE document_asset_permissions; DROP TABLE document_asset_versions;
--           DROP TABLE document_assets.

CREATE TABLE IF NOT EXISTS document_assets (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id    UUID        REFERENCES branches(id),
  category     TEXT        NOT NULL
                 CHECK (category IN (
                   'company_stamp', 'branch_stamp', 'department_stamp', 'signature', 'logo',
                   'image', 'qr_config'
                 )),
  name         TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  mime         TEXT        NOT NULL,
  width_px     INTEGER,
  height_px    INTEGER,
  checksum     TEXT,
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by   UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_assets_tenant_category
  ON document_assets (tenant_id, category)
  WHERE deleted_at IS NULL;

-- Replacing an asset's file keeps the previous versions instead of overwriting them in place.
CREATE TABLE IF NOT EXISTS document_asset_versions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id     UUID        NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
  version      INTEGER     NOT NULL CHECK (version >= 1),
  storage_path TEXT        NOT NULL,
  created_by   UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_asset_versions_version
  ON document_asset_versions (asset_id, version);

-- Who may place/issue a document using a sensitive asset (stamp/signature). Either role_id or
-- branch_id scopes the grant; neither set means "tenant-wide" (every role/branch may use it).
CREATE TABLE IF NOT EXISTS document_asset_permissions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id   UUID        NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
  role_id    UUID        REFERENCES roles(id),
  branch_id  UUID        REFERENCES branches(id),
  can_use    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_asset_permissions_asset
  ON document_asset_permissions (asset_id)
  WHERE deleted_at IS NULL;

ALTER TABLE document_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_assets;
CREATE POLICY tenant_session_isolation ON document_assets
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_assets TO service_role;

ALTER TABLE document_asset_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_asset_versions;
CREATE POLICY tenant_session_isolation ON document_asset_versions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_asset_versions TO service_role;

ALTER TABLE document_asset_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_asset_permissions;
CREATE POLICY tenant_session_isolation ON document_asset_permissions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_asset_permissions TO service_role;
