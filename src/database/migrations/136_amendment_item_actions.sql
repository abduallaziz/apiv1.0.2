-- Purchasing #9.5.6.2: explicit action column for agreement_amendment_items
-- (add/modify/discontinue), decided after two rejected alternatives:
-- (1) creating the real agreement_items row during Draft -- rejected,
-- Draft must never affect operational state; (2) inferring the action
-- from which columns happen to be NULL -- rejected as implicit and
-- ambiguity-prone. This migration makes the action explicit and DB-
-- enforced via a CHECK constraint, with zero effect on agreement_items
-- until fn_approve_agreement_amendment (137) actually applies it.

ALTER TABLE agreement_amendment_items
  ADD COLUMN action TEXT NOT NULL CHECK (action IN ('modify', 'add', 'discontinue'));

-- 'add' lines reference a NOT-YET-EXISTING agreement_item (it is created
-- only at approve() time), so agreement_item_id must become nullable.
ALTER TABLE agreement_amendment_items
  ALTER COLUMN agreement_item_id DROP NOT NULL;

-- Staging fields for 'add' lines only -- the pending new item's identity,
-- held here until approval, never written to agreement_items before then.
ALTER TABLE agreement_amendment_items
  ADD COLUMN new_item_id UUID REFERENCES items(id) ON DELETE RESTRICT,
  ADD COLUMN new_variant_id UUID REFERENCES item_variants(id) ON DELETE RESTRICT;

-- Whether new_variant_id is REQUIRED for a given 'add' line depends on
-- items.has_variants (a fact on a different table) -- not expressible in
-- a single-row CHECK constraint, so that part of the rule is enforced in
-- AmendmentsService.create(), matching this project's existing precedent
-- of application-layer eligibility rules (9.5.3's commercial vs
-- administrative_correction gate).
ALTER TABLE agreement_amendment_items
  ADD CONSTRAINT chk_amendment_item_action_shape CHECK (
    (action = 'add' AND agreement_item_id IS NULL AND new_item_id IS NOT NULL)
    OR (action IN ('modify', 'discontinue') AND agreement_item_id IS NOT NULL AND new_item_id IS NULL AND new_variant_id IS NULL)
  );
