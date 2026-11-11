-- 255. Customer auto-recognition (T12/G2), worker commission snapshot per
-- invoice line (G4), per-tenant enabled payment methods (T11/G8).
-- Owner approval 2026-11-09 ("Approved - Proceed with Implementation").
--
-- T12 rules: one customer = ONE phone (unique per tenant, normalised = last 9
-- digits) and ANY number of cars; each plate (normalised: no spaces/dashes,
-- upper-case) is unique per tenant and belongs to exactly one customer.
--
-- New-table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.

-- ---------------------------------------------------------------- helpers
-- Arabic-Indic (U+0660..0669) and Extended Arabic-Indic (U+06F0..06F9) digits
-- are mapped to ASCII, everything non-digit is dropped, last 9 digits kept.
CREATE OR REPLACE FUNCTION fn_normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    right(
      regexp_replace(
        translate(coalesce(p_phone, ''),
          U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
          '01234567890123456789'),
        '[^0-9]', '', 'g'),
      9),
    '')
$$;

CREATE OR REPLACE FUNCTION fn_normalize_plate(p_plate text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    upper(regexp_replace(
      translate(coalesce(p_plate, ''),
        U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
        '01234567890123456789'),
      '[\s\-_.]', '', 'g')),
    '')
$$;

-- ------------------------------------------------------ customers.phone_normalized
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
UPDATE customers SET phone_normalized = fn_normalize_phone(phone)
 WHERE phone_normalized IS NULL AND phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_phone_normalized
  ON customers (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION fn_customers_set_phone_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.phone_normalized := fn_normalize_phone(NEW.phone);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customers_phone_normalized ON customers;
CREATE TRIGGER trg_customers_phone_normalized
  BEFORE INSERT OR UPDATE OF phone ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_customers_set_phone_normalized();

-- ------------------------------------------------------------ customer_vehicles
CREATE TABLE IF NOT EXISTS customer_vehicles (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID        NOT NULL REFERENCES customers(id),
  plate            TEXT        NOT NULL,
  plate_normalized TEXT        NOT NULL,
  size             TEXT,
  model            TEXT,
  colour           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_vehicles_tenant_plate
  ON customer_vehicles (tenant_id, plate_normalized) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_vehicles_customer
  ON customer_vehicles (tenant_id, customer_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION fn_customer_vehicles_set_plate_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.plate_normalized := fn_normalize_plate(NEW.plate);
  IF NEW.plate_normalized IS NULL THEN
    RAISE EXCEPTION 'plate must not be empty';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_vehicles_plate_normalized ON customer_vehicles;
CREATE TRIGGER trg_customer_vehicles_plate_normalized
  BEFORE INSERT OR UPDATE OF plate ON customer_vehicles
  FOR EACH ROW EXECUTE FUNCTION fn_customer_vehicles_set_plate_normalized();

ALTER TABLE customer_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON customer_vehicles
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.customer_vehicles TO service_role;

-- Migrate the legacy single plate. The unique index makes this fail loudly
-- (instead of silently merging) if two customers ever shared a plate; live
-- data was checked on 2026-11-09 and has none.
INSERT INTO customer_vehicles (tenant_id, customer_id, plate, plate_normalized)
SELECT c.tenant_id, c.id, btrim(c.plate_number), fn_normalize_plate(c.plate_number)
  FROM customers c
 WHERE c.deleted_at IS NULL
   AND fn_normalize_plate(c.plate_number) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM customer_vehicles v
      WHERE v.tenant_id = c.tenant_id AND v.customer_id = c.id
        AND v.plate_normalized = fn_normalize_plate(c.plate_number)
        AND v.deleted_at IS NULL);

-- ------------------------------------------------- orders: car + invoice snapshot
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS vehicle_id     UUID REFERENCES customer_vehicles(id),
  ADD COLUMN IF NOT EXISTS plate_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_size   TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_vehicle ON orders (tenant_id, vehicle_id) WHERE vehicle_id IS NOT NULL;

-- ----------------------------------------- G4: worker + commission per line
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS worker_id         UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS commission_rate   NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2);
CREATE INDEX IF NOT EXISTS idx_order_items_worker ON order_items (worker_id) WHERE worker_id IS NOT NULL;

-- ------------------------- T11/G8: payment methods enabled per tenant
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS enabled_payment_methods JSONB NOT NULL
  DEFAULT '["cash","card","split","wallet","mada","visa","mastercard","stc_pay","apple_pay","tab"]'::jsonb;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_enabled_payment_methods;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_enabled_payment_methods CHECK (
  jsonb_typeof(enabled_payment_methods) = 'array'
  AND enabled_payment_methods ? 'cash'
);
