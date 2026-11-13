-- Document Template Builder, Phase 1 (generation): the immutable issued-document record, its
-- public verification token, and the approval trail required before a sensitive asset may be used
-- to issue. Design: docs/DESIGN_DOCUMENT_BUILDER.md §3.7-3.9. Feature flag:
-- DOCUMENTS_BUILDER_ENABLED. Does not touch orders/invoices/ZATCA tables or logic.
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP TABLE document_approvals; DROP TABLE document_verification_tokens;
--           DROP TABLE generated_documents.

-- One row per issued document. Never updated after insert: re-issuing creates a new row rather
-- than mutating an old one, so a previously generated document can never change retroactively.
CREATE TABLE IF NOT EXISTS generated_documents (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type           TEXT        NOT NULL
                       CHECK (doc_type IN (
                         'quotation', 'tax_invoice', 'simplified_invoice', 'receipt',
                         'payment_voucher', 'work_order', 'delivery_note', 'purchase_order',
                         'customer_statement', 'custom'
                       )),
  source_ref         TEXT,
  template_version_id UUID        NOT NULL REFERENCES document_template_versions(id),
  rendered_html      TEXT        NOT NULL,
  resolved_data      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  asset_refs         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  pdf_storage_path   TEXT,
  status             TEXT        NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  issued_by          UUID        REFERENCES users(id),
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant_type
  ON generated_documents (tenant_id, doc_type, issued_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_generated_documents_source_ref
  ON generated_documents (tenant_id, source_ref)
  WHERE source_ref IS NOT NULL AND deleted_at IS NULL;

-- Public, read-only, whitelist-only verification: GET /public/verify/:token requires no auth, so
-- public_fields must never carry more than what the issuer explicitly chose to expose.
CREATE TABLE IF NOT EXISTS document_verification_tokens (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  generated_document_id UUID        NOT NULL REFERENCES generated_documents(id) ON DELETE CASCADE,
  token                 TEXT        NOT NULL,
  public_fields         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_verification_tokens_token
  ON document_verification_tokens (token)
  WHERE deleted_at IS NULL;

-- Immutable approval decision. Using a sensitive stamp/signature to issue a document requires a
-- decision = 'approved' row here (server-checked at issue time, not in the editor) before the
-- corresponding generated_documents row may be created.
CREATE TABLE IF NOT EXISTS document_approvals (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type               TEXT        NOT NULL
                           CHECK (doc_type IN (
                             'quotation', 'tax_invoice', 'simplified_invoice', 'receipt',
                             'payment_voucher', 'work_order', 'delivery_note', 'purchase_order',
                             'customer_statement', 'custom'
                           )),
  template_id            UUID        NOT NULL REFERENCES document_templates(id),
  generated_document_id  UUID        REFERENCES generated_documents(id),
  approver_id            UUID        NOT NULL REFERENCES users(id),
  decision               TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason                 TEXT,
  approved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_approvals_tenant_type
  ON document_approvals (tenant_id, doc_type, approved_at DESC);

ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON generated_documents;
CREATE POLICY tenant_session_isolation ON generated_documents
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.generated_documents TO service_role;

ALTER TABLE document_verification_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_verification_tokens;
CREATE POLICY tenant_session_isolation ON document_verification_tokens
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_verification_tokens TO service_role;

ALTER TABLE document_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON document_approvals;
CREATE POLICY tenant_session_isolation ON document_approvals
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.document_approvals TO service_role;
