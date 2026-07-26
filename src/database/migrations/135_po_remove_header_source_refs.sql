-- Migration 135:
-- Remove header-level agreement references from purchase_orders.
-- Source ownership is maintained exclusively at purchase_order_items level.
-- A single PO may contain items from multiple agreements/releases.
-- Header references caused an incorrect single-source assumption.

ALTER TABLE purchase_orders
  DROP CONSTRAINT fk_po_source_release;

ALTER TABLE purchase_orders
  DROP CONSTRAINT chk_po_source_release_requires_agreement;

DROP INDEX idx_po_source_agreement;
DROP INDEX idx_po_source_release;

ALTER TABLE purchase_orders
  DROP COLUMN source_agreement_id,
  DROP COLUMN source_release_id;

-- agreement_releases.uq_agreement_releases_id_agreement (added in 134
-- solely to support the now-removed composite FK) is left in place --
-- harmless (id is already globally unique), and dropping it would gain
-- nothing. Kept for consistency with 133's identical precedent on
-- agreement_amendments, which also remains in place unconditionally.
