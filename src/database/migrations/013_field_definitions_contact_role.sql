ALTER TABLE customer_field_definitions
  ADD COLUMN IF NOT EXISTS contact_role TEXT
  CHECK (contact_role IN ('phone', 'email'));
