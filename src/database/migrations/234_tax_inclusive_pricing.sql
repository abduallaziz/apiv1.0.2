-- Tax Pricing Phase 1 (Owner-approved) — tenant-level tax-inclusive-pricing
-- support. Existing tenants.tax_rate remains the sole tax-rate Source of
-- Truth; this column only determines how item prices are interpreted
-- (net/exclusive vs gross/inclusive). Safe default (false) preserves the
-- existing exclusive behavior for every current tenant unchanged. No
-- order_items / multi-rate / branch / product / price-list architecture —
-- explicitly out of Phase 1 scope per approved design.
ALTER TABLE tenants ADD COLUMN tax_inclusive_pricing BOOLEAN NOT NULL DEFAULT false;
