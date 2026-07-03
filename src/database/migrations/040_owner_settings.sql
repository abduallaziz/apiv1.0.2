-- Phase 10L — Owner Settings: invoice customization (footer), printer settings, notification preferences.
-- logo_url and tax_number already existed on tenants but were never exposed via the API — this migration
-- only adds the columns that were genuinely missing.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS invoice_footer TEXT,
  ADD COLUMN IF NOT EXISTS printer_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
