-- Document Template Builder, Phase 10: enforce immutability IN THE DATABASE, not only in code
-- (design A6 / §5.2): an issued document never changes, and an approval decision is a permanent
-- record. Triggers fire for every role, including service_role.
--  * generated_documents: only `status` (issued -> void) and `deleted_at` may change; the snapshot
--    columns (html, data, assets, template version, pdf, issuer, issue time) are frozen.
--  * document_approvals: no UPDATE, no DELETE.
-- ROLLBACK: DROP TRIGGER trg_generated_documents_immutable ON generated_documents;
--           DROP TRIGGER trg_document_approvals_immutable ON document_approvals;
--           DROP FUNCTION fn_generated_documents_immutable(); DROP FUNCTION fn_document_approvals_immutable();

CREATE OR REPLACE FUNCTION fn_generated_documents_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.rendered_html IS DISTINCT FROM OLD.rendered_html
     OR NEW.resolved_data IS DISTINCT FROM OLD.resolved_data
     OR NEW.asset_refs IS DISTINCT FROM OLD.asset_refs
     OR NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'generated_documents rows are immutable (only status / deleted_at may change)';
  END IF;
  -- a voided document stays void
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'a voided document cannot be re-issued; issue a new one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generated_documents_immutable ON generated_documents;
CREATE TRIGGER trg_generated_documents_immutable
  BEFORE UPDATE ON generated_documents
  FOR EACH ROW EXECUTE FUNCTION fn_generated_documents_immutable();

CREATE OR REPLACE FUNCTION fn_document_approvals_immutable() RETURNS trigger AS $$
BEGIN
  -- a cascade from deleting the whole tenant (FK ON DELETE CASCADE) is not a user edit
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'document_approvals rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_approvals_immutable ON document_approvals;
CREATE TRIGGER trg_document_approvals_immutable
  BEFORE UPDATE OR DELETE ON document_approvals
  FOR EACH ROW EXECUTE FUNCTION fn_document_approvals_immutable();
