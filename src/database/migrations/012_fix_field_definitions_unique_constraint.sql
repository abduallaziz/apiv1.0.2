ALTER TABLE customer_field_definitions
  DROP CONSTRAINT IF EXISTS customer_field_definitions_tenant_id_field_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_field_definitions_tenant_field_key
  ON customer_field_definitions(tenant_id, field_key)
  WHERE deleted_at IS NULL;
