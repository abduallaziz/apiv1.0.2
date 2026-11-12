-- ZATCA: keep the exact input each document was generated from, so a credit note for a cancelled
-- sale is derived from the original figures (not recomputed from data that may have changed).
-- Additive and nullable; rows issued before this migration simply have no snapshot.
ALTER TABLE zatca_invoices ADD COLUMN IF NOT EXISTS doc_input jsonb;
-- Which sales return produced this credit note (NULL = a full-cancellation credit note). Lets a sale
-- carry several credit notes, one per partial return, idempotently.
ALTER TABLE zatca_invoices ADD COLUMN IF NOT EXISTS return_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_zatca_invoices_return
  ON zatca_invoices (tenant_id, return_id) WHERE return_id IS NOT NULL AND deleted_at IS NULL;

-- ZATCA onboarding progress: the compliance request id (exchanged for the production CSID) and the
-- moment the Authority accepted all compliance-check documents.
ALTER TABLE zatca_devices ADD COLUMN IF NOT EXISTS compliance_request_id text;
ALTER TABLE zatca_devices ADD COLUMN IF NOT EXISTS compliance_checked_at timestamptz;
