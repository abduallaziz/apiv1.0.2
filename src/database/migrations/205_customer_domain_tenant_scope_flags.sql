-- Customer Domain Phase 1 (Owner-approved) — three independent tenant-level
-- policy flags. customer_identity_scope and loyalty_scope govern the
-- upcoming Customer↔Branch relationship model and Loyalty ledger
-- (Phases 2+); rewards_enabled gates the not-yet-built Rewards domain
-- entirely. All three default to the value that exactly matches every
-- existing tenant's current, unconditional behavior — 'shared' identity,
-- 'shared' loyalty (there is only ever one pooled balance today), and
-- rewards disabled (no Rewards domain exists yet). No application code
-- reads these columns as of this migration; they are inert until later
-- phases wire them in.
ALTER TABLE tenants
  ADD COLUMN customer_identity_scope TEXT NOT NULL DEFAULT 'shared'
    CHECK (customer_identity_scope IN ('shared', 'branch')),
  ADD COLUMN loyalty_scope TEXT NOT NULL DEFAULT 'shared'
    CHECK (loyalty_scope IN ('shared', 'branch')),
  ADD COLUMN rewards_enabled BOOLEAN NOT NULL DEFAULT false;
