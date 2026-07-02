-- =============================================================================
-- 010: Phase 10C follow-up — full_name/phone become owner-configurable
-- Context: the owner decides via customer_field_definitions which fields
-- exist and whether each is required — including the built-in "full_name"
-- and "phone" fields. They must no longer be hardcoded-required at the DB
-- level; required-ness is enforced in the service layer from the field
-- definition instead. phone was already nullable.
-- =============================================================================

ALTER TABLE customers ALTER COLUMN full_name DROP NOT NULL;
