-- VAT category for ZATCA: a tenant whose supplies are zero-rated / exempt / out-of-scope sets the
-- category and a VATEX reason, instead of a positive tax_rate. Default 'S' (standard-rated) keeps
-- every existing tenant exactly as it is.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_category text NOT NULL DEFAULT 'S'
  CHECK (tax_category IN ('S', 'Z', 'E', 'O'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_exemption_reason_code text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_exemption_reason text;
