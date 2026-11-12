-- Buyer tax identity for standard (B2B) ZATCA invoices. A customer with a VAT number and a national
-- address turns their sales into standard tax invoices (cleared), not simplified ones. All additive
-- and nullable: ordinary B2C customers leave these empty and keep getting simplified invoices.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number     text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS commercial_reg text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_building text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_district text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_city   text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_postal text;
