-- Customer Domain Phase 2 (Owner-approved) — customers gain an optional
-- creation/source branch context. This is informational provenance only —
-- NOT ownership, NOT an authorization/visibility scope, NOT a restriction
-- on which branch a customer may transact at. That distinction is
-- deliberate: the approved architecture explicitly rejects a permanent
-- customers.branch_id ownership model in favor of a many-valued
-- customer<->branch relationship model (customer_branch_relationships,
-- Phase 3). created_branch_id simply records "which branch context existed
-- when this customer record was made," nothing more.
--
-- No backfill: historical creation context cannot be reliably inferred for
-- any existing customer row, so every existing row gets NULL (the honest
-- "unknown" state), never a guess.
ALTER TABLE customers
  ADD COLUMN created_branch_id UUID REFERENCES branches(id);
