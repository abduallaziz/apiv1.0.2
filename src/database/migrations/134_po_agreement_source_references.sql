-- Purchasing #9.5.5: Purchase Order source-reference columns only.
-- A Purchase Order is still the ONLY document that has real accounting/
-- inventory impact (per the standing architectural decision: Agreements/
-- Amendments/Releases never touch stock_movements or cost_layers). This
-- step makes a PO able to record WHICH Agreement/Release (and, per line,
-- which Agreement Item/Release Item) it was sourced from -- pure
-- traceability, all four columns nullable, since most POs will continue
-- to have no Agreement behind them at all (ad-hoc purchasing stays
-- fully supported, unchanged).
--
-- No new business logic beyond traceability is introduced here: no
-- validation of committed_quantity/remaining_value against the PO, no
-- automatic quantity/price copying, no status coupling between PO and
-- Release. That is deliberately out of scope for 9.5.5 and belongs to
-- 9.5.6 (backend/service layer), not to this schema step.
--
-- Same consistency class of gap as 9.5.4, same fix: a plain nullable FK
-- on source_release_id would only check the release exists, not that it
-- belongs to the SAME agreement as source_agreement_id on the same row.
-- Composite FK, same reasoning as migration 133 (native index lookup,
-- zero procedural code, consistent with this project's declarative-
-- constraint-first philosophy). Two prerequisite UNIQUE constraints are
-- needed first (agreement_releases and agreement_release_items did not
-- need a composite-unique target until now):

ALTER TABLE agreement_releases
  ADD CONSTRAINT uq_agreement_releases_id_agreement UNIQUE (id, agreement_id);

ALTER TABLE agreement_release_items
  ADD CONSTRAINT uq_agreement_release_items_id_agreement_item UNIQUE (id, agreement_item_id);

-- Header-level source references on purchase_orders.
-- ON DELETE SET NULL (not RESTRICT): unlike agreement_releases.agreement_id
-- (which is the release's own core identity), source_agreement_id /
-- source_release_id are pure nullable traceability pointers on the PO --
-- if the source Agreement/Release is ever removed, the PO itself must
-- remain valid and simply lose the backward reference. Both columns are
-- nullable, so SET NULL never conflicts with a NOT NULL column (the
-- ON DELETE SET NULL problem solved differently in 133 does not apply
-- here).
ALTER TABLE purchase_orders
  ADD COLUMN source_agreement_id UUID REFERENCES agreements(id) ON DELETE SET NULL,
  ADD COLUMN source_release_id   UUID;

ALTER TABLE purchase_orders
  ADD CONSTRAINT chk_po_source_release_requires_agreement
  CHECK (source_release_id IS NULL OR source_agreement_id IS NOT NULL);

ALTER TABLE purchase_orders
  ADD CONSTRAINT fk_po_source_release
  FOREIGN KEY (source_release_id, source_agreement_id)
  REFERENCES agreement_releases (id, agreement_id)
  ON DELETE SET NULL;

CREATE INDEX idx_po_source_agreement ON purchase_orders(source_agreement_id) WHERE source_agreement_id IS NOT NULL;
CREATE INDEX idx_po_source_release ON purchase_orders(source_release_id) WHERE source_release_id IS NOT NULL;

-- Line-level source references on purchase_order_items -- same
-- composite-FK technique, this time anchored on agreement_item_id
-- instead of agreement_id, guaranteeing a PO line's source_release_item_id
-- can only ever point at a release item that truly belongs to the same
-- source_agreement_item_id recorded on that same PO line.
ALTER TABLE purchase_order_items
  ADD COLUMN source_agreement_item_id UUID REFERENCES agreement_items(id) ON DELETE SET NULL,
  ADD COLUMN source_release_item_id   UUID;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT chk_poi_source_release_item_requires_agreement_item
  CHECK (source_release_item_id IS NULL OR source_agreement_item_id IS NOT NULL);

ALTER TABLE purchase_order_items
  ADD CONSTRAINT fk_poi_source_release_item
  FOREIGN KEY (source_release_item_id, source_agreement_item_id)
  REFERENCES agreement_release_items (id, agreement_item_id)
  ON DELETE SET NULL;

CREATE INDEX idx_poi_source_agreement_item ON purchase_order_items(source_agreement_item_id) WHERE source_agreement_item_id IS NOT NULL;
CREATE INDEX idx_poi_source_release_item ON purchase_order_items(source_release_item_id) WHERE source_release_item_id IS NOT NULL;

-- Known, explicitly NOT closed here (flagged, not silently decided):
-- nothing at the database level ties a PO line's source_release_item_id
-- back to the SAME source_release_id recorded on that line's own PO
-- header. Closing that would require either (a) denormalizing release_id
-- onto purchase_order_items to support a 3-column composite FK, a new
-- column beyond the 4 approved for 9.5.5, or (b) a trigger. Both are
-- schema-shape/architecture decisions beyond this step's approved scope
-- (4 nullable traceability columns only) -- surfaced to the user for an
-- explicit decision rather than silently added or silently skipped.
