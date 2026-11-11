-- 264_activity_definitions.sql   (PENDING — not applied, not yet verified on a database)
-- P2: global catalog of business activities (37 existing in web onboarding + 'tireOil' as the 38th)
-- and the capabilities each enables. Global table: no tenant_id (read-only reference data).
-- Defaults below are PROVISIONAL, set per section only; per-activity refinement waits for the
-- owner's keep/edit/delete answers (decision D8). Idempotent (ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS activity_definitions (
  code               TEXT        PRIMARY KEY,
  section            TEXT        NOT NULL,
  name_en            TEXT        NOT NULL,
  name_ar            TEXT,
  sort_order         INT         NOT NULL DEFAULT 0,
  workflow           TEXT        NOT NULL DEFAULT 'instant'
                                 CHECK (workflow IN ('instant', 'table_kitchen', 'queue', 'work_order', 'appointment')),
  stock_mode         TEXT        NOT NULL DEFAULT 'qty'
                                 CHECK (stock_mode IN ('none', 'qty', 'batch_expiry', 'serial', 'recipe')),
  capabilities       TEXT[]      NOT NULL DEFAULT '{}',
  payment_modes      TEXT[]      NOT NULL DEFAULT '{standard}',
  pricing_dimensions JSONB       NOT NULL DEFAULT '[]'::jsonb,
  customer_fields    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activity_definitions_dims_is_array   CHECK (jsonb_typeof(pricing_dimensions) = 'array'),
  CONSTRAINT activity_definitions_fields_is_array CHECK (jsonb_typeof(customer_fields) = 'array')
);

GRANT ALL PRIVILEGES ON public.activity_definitions TO service_role;

INSERT INTO activity_definitions (code, section, name_en, sort_order, workflow, stock_mode, capabilities)
VALUES
  -- restaurants
  ('restaurant','restaurants','Restaurant',1,'table_kitchen','recipe','{pos.menu,tables,kitchen}'),
  ('cafe','restaurants','Cafe',2,'table_kitchen','recipe','{pos.menu,tables,kitchen}'),
  ('fastFood','restaurants','Fast food',3,'instant','recipe','{pos.menu,kitchen}'),
  ('bakery','restaurants','Bakery',4,'instant','recipe','{pos.grid,batches}'),
  ('juice','restaurants','Juice bar',5,'instant','recipe','{pos.menu}'),
  ('foodTruck','restaurants','Food truck',6,'instant','recipe','{pos.menu}'),
  -- retail
  ('grocery','retail','Grocery',10,'instant','batch_expiry','{pos.grid,barcode,batches}'),
  ('supermarket','retail','Supermarket',11,'instant','batch_expiry','{pos.grid,barcode,batches,scales}'),
  ('perfume','retail','Perfume',12,'instant','qty','{pos.grid,barcode}'),
  ('stationery','retail','Stationery',13,'instant','qty','{pos.grid,barcode}'),
  ('gifts','retail','Gifts',14,'instant','qty','{pos.grid,barcode}'),
  -- fashion
  ('menClothing','fashion','Men clothing',20,'instant','qty','{pos.grid,barcode,variants}'),
  ('womenClothing','fashion','Women clothing',21,'instant','qty','{pos.grid,barcode,variants}'),
  ('shoes','fashion','Shoes',22,'instant','qty','{pos.grid,barcode,variants}'),
  ('accessories','fashion','Accessories',23,'instant','qty','{pos.grid,barcode}'),
  ('tailoring','fashion','Tailoring',24,'work_order','none','{pos.services,work_orders,appointments}'),
  -- health
  ('pharmacy','health','Pharmacy',30,'instant','batch_expiry','{pos.grid,barcode,batches}'),
  ('medical','health','Medical supplies',31,'instant','batch_expiry','{pos.grid,barcode,batches}'),
  ('clinic','health','Clinic',32,'appointment','none','{pos.services,appointments}'),
  ('optics','health','Optics',33,'work_order','qty','{pos.grid,work_orders}'),
  ('supplements','health','Supplements',34,'instant','batch_expiry','{pos.grid,barcode,batches}'),
  -- beauty
  ('barber','beauty','Barber',40,'appointment','none','{pos.services,appointments,staff_commission}'),
  ('womenSalon','beauty','Women salon',41,'appointment','none','{pos.services,appointments,staff_commission}'),
  ('spa','beauty','Spa',42,'appointment','none','{pos.services,appointments,packages}'),
  ('cosmetics','beauty','Cosmetics',43,'instant','qty','{pos.grid,barcode}'),
  -- services
  ('carWash','services','Car wash',50,'queue','none','{pos.services,queue,vehicles,staff_commission}'),
  ('laundry','services','Laundry',51,'work_order','none','{pos.services,work_orders,delivery}'),
  ('phoneFix','services','Phone repair',52,'work_order','serial','{pos.services,work_orders,serials,warranty}'),
  ('carWorkshop','services','Car workshop',53,'work_order','qty','{pos.services,work_orders,vehicles,warranty}'),
  ('homeServices','services','Home services',54,'work_order','none','{pos.services,work_orders,appointments,delivery}'),
  ('tireOil','services','Tire & oil change',55,'queue','qty','{pos.services,queue,vehicles,warranty}'),
  -- electronics
  ('phones','electronics','Phones',60,'instant','serial','{pos.grid,barcode,serials,warranty}'),
  ('gadgets','electronics','Gadgets',61,'instant','serial','{pos.grid,barcode,serials,warranty}'),
  ('gaming','electronics','Gaming',62,'instant','serial','{pos.grid,barcode,serials,warranty}'),
  -- home
  ('furniture','home','Furniture',70,'instant','qty','{pos.grid,delivery,deposits}'),
  ('homeware','home','Homeware',71,'instant','qty','{pos.grid,barcode}'),
  ('flowers','home','Flowers',72,'instant','batch_expiry','{pos.grid,delivery,deposits}'),
  ('pets','home','Pets',73,'instant','qty','{pos.grid,barcode}')
ON CONFLICT (code) DO NOTHING;

-- ROLLBACK: DROP TABLE IF EXISTS activity_definitions;
