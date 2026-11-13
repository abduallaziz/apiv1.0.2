-- Document Template Builder, Phase 1 (core): templates, their versioned bodies, and
-- branch/tenant assignment. Design: docs/DESIGN_DOCUMENT_BUILDER.md. Feature flag:
-- DOCUMENTS_BUILDER_ENABLED (off by default). Isolated from orders/invoices/ZATCA — no existing
-- table is touched by this migration.
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP TABLE document_template_assignments; DROP TABLE document_template_versions;
--           DROP TABLE document_templates;

CREATE TABLE IF NOT EXISTS document_templates (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type           TEXT        NOT NULL
                       CHECK (doc_type IN (
                         'quotation', 'tax_invoice', 'simplified_invoice', 'receipt',
                         'payment_voucher', 'work_order', 'delivery_note', 'purchase_order',
                         'customer_statement', 'custom'
                       )),
  name               TEXT        NOT NULL,
  description        TEXT,
  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'published', 'archived')),
  is_default         BOOLEAN     NOT NULL DEFAULT FALSE,
  paper              TEXT        NOT NULL DEFAULT 'A4'
                       CHECK (paper IN ('A4', 'A5', '80mm', '58mm')),
  orientation        TEXT        NOT NULL DEFAULT 'portrait'
                       CHECK (orientation IN ('portrait', 'landscape')),
  -- FK to document_template_versions added after that table exists (see below); nullable until a
  -- first version is created.
  current_version_id UUID,
  created_by         UUID        REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

-- One default template per (tenant, doc_type).
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_templates_default
  ON document_templates (tenant_id, doc_type)
  WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_templates_tenant_type
  ON document_templates (tenant_id, doc_type)
  WHERE deleted_at IS NULL;

-- Immutable snapshot of a template's body (page defs + element instances + bindings). Publishing a
-- template points current_version_id at one of these rows; editing a published template creates a
-- new draft version rather than mutating the one in use.
CREATE TABLE IF NOT EXISTS document_template_versions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID        NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL CHECK (version >= 1),
  body        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  note        TEXT,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_template_versions_version
  ON document_template_versions (template_id, version);

ALTER TABLE document_templates
  ADD CONSTRAINT fk_document_templates_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_template_versions(id);

-- Which template applies where: a specific branch, or the tenant as a whole. Resolution order at
-- issue time is branch assignment -> tenant default -> built-in fallback (enforced in code, not SQL).
CREATE TABLE IF NOT EXISTS document_template_assignments (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID        NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  scope       TEXT        NOT NULL CHECK (scope IN ('tenant', 'branch')),
  branch_id   UUID        REFERENCES branches(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  CHECK (
    (scope = 'branch' AND branch_id IS NOT NULL) OR
    (scope = 'tenant' AND branch_id IS NULL)
  )
);

-- One active assignment per branch, and one per tenant-wide scope, for the template's doc_type.
-- doc_type itself lives on document_templates, so this is enforced by joining at query time; the
-- partial index below prevents two live assignments for the exact same (template, scope, branch).
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_template_assignments_branch
  ON document_template_assignments (tenant_id, branch_id)
  WHERE scope = 'branch' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_template_assignments_tenant
  ON document_template_assignments (tenant_id, template_id)
  WHERE scope = 'tenant' AND deleted_at IS NULL;

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_templates;
CREATE POLICY tenant_session_isolation ON document_templates
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_templates TO service_role;

ALTER TABLE document_template_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_template_versions;
CREATE POLICY tenant_session_isolation ON document_template_versions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_template_versions TO service_role;

ALTER TABLE document_template_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_template_assignments;
CREATE POLICY tenant_session_isolation ON document_template_assignments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_template_assignments TO service_role;
