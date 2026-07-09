-- Loyalty points/tiers/redemption have always been unconditionally active for
-- every tenant since migration 041 — there was never a way to turn the whole
-- program off. Default TRUE preserves current behavior for every existing
-- tenant; a tenant can now opt out entirely via PATCH /tenant/profile.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN NOT NULL DEFAULT true;
