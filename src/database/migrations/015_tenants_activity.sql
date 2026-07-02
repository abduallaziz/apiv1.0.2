-- Add granular activity (one of 37 onboarding sub-activities) alongside the existing
-- broad business_type (6 categories). business_type is kept as-is for backward
-- compatibility with existing features (e.g. vehicle customer fields keyed on
-- business_type IN ('workshop','services')). activity is purely additive and nullable
-- so existing tenants registered before this migration keep working unchanged.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activity VARCHAR(40);
