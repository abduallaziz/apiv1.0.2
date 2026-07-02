ALTER TABLE customer_field_definitions
  DROP CONSTRAINT IF EXISTS customer_field_definitions_contact_role_check;

ALTER TABLE customer_field_definitions
  ADD CONSTRAINT customer_field_definitions_contact_role_check
  CHECK (contact_role IN ('phone', 'email', 'plate_number', 'visit_date', 'odometer'));

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS plate_number TEXT,
  ADD COLUMN IF NOT EXISTS visit_date DATE,
  ADD COLUMN IF NOT EXISTS odometer INTEGER;
