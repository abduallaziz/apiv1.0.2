-- ZATCA: keep the exact input each document was generated from, so a credit note for a cancelled
-- sale is derived from the original figures (not recomputed from data that may have changed).
-- Additive and nullable; rows issued before this migration simply have no snapshot.
ALTER TABLE zatca_invoices ADD COLUMN IF NOT EXISTS doc_input jsonb;

-- ZATCA onboarding progress: the compliance request id (exchanged for the production CSID) and the
-- moment the Authority accepted all compliance-check documents.
ALTER TABLE zatca_devices ADD COLUMN IF NOT EXISTS compliance_request_id text;
ALTER TABLE zatca_devices ADD COLUMN IF NOT EXISTS compliance_checked_at timestamptz;
