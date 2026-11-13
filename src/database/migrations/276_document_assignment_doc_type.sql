-- Fix to 273: a branch/tenant assignment must be unique PER DOCUMENT TYPE, not per branch overall
-- (a branch needs one quotation template AND one receipt template). Adds doc_type to assignments and
-- rebuilds the unique indexes. The table has no rows yet (Phase 1 shipped no routes).
-- ROLLBACK: restore the two indexes from 273 and DROP COLUMN doc_type.

ALTER TABLE document_template_assignments ADD COLUMN IF NOT EXISTS doc_type TEXT;
UPDATE document_template_assignments a
   SET doc_type = t.doc_type
  FROM document_templates t
 WHERE t.id = a.template_id AND a.doc_type IS NULL;
ALTER TABLE document_template_assignments ALTER COLUMN doc_type SET NOT NULL;

DROP INDEX IF EXISTS uq_document_template_assignments_branch;
DROP INDEX IF EXISTS uq_document_template_assignments_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_template_assignments_branch
  ON document_template_assignments (tenant_id, branch_id, doc_type)
  WHERE scope = 'branch' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_template_assignments_tenant
  ON document_template_assignments (tenant_id, doc_type)
  WHERE scope = 'tenant' AND deleted_at IS NULL;
