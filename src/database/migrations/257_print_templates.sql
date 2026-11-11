-- 257_print_templates.sql
-- T13 + printing tasks T1-T3: customer-invoice and kitchen-ticket print templates.
-- tenants.*_template  : jsonb, default '{}' = "today's look" (every field falls back to
--                       the existing tenant columns: name, logo_url, address, phone,
--                       tax_number, invoice_footer, printer_settings).
-- branches.*_template : nullable jsonb override; NULL or '{}' = no override, otherwise
--                       the branch template wins over the tenant template.
-- Purely additive, idempotent, no data migration.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS invoice_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS kitchen_template JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS invoice_template JSONB,
  ADD COLUMN IF NOT EXISTS kitchen_template JSONB;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_invoice_template_is_object,
  ADD CONSTRAINT tenants_invoice_template_is_object CHECK (jsonb_typeof(invoice_template) = 'object'),
  DROP CONSTRAINT IF EXISTS tenants_kitchen_template_is_object,
  ADD CONSTRAINT tenants_kitchen_template_is_object CHECK (jsonb_typeof(kitchen_template) = 'object');

ALTER TABLE branches
  DROP CONSTRAINT IF EXISTS branches_invoice_template_is_object,
  ADD CONSTRAINT branches_invoice_template_is_object CHECK (invoice_template IS NULL OR jsonb_typeof(invoice_template) = 'object'),
  DROP CONSTRAINT IF EXISTS branches_kitchen_template_is_object,
  ADD CONSTRAINT branches_kitchen_template_is_object CHECK (kitchen_template IS NULL OR jsonb_typeof(kitchen_template) = 'object');
