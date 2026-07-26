-- Purchasing #9.5.4 follow-up (data-integrity fix, not a new step):
-- Migration 132's agreement_releases.effective_amendment_id FK only
-- checked that the referenced amendment EXISTS -- it did not check that
-- the amendment belongs to the SAME agreement as the release referencing
-- it. That left a real gap: a Release could theoretically point at an
-- Amendment from a completely different Agreement.
--
-- Solution chosen: Composite Foreign Key, not a Trigger.
--   1) Add UNIQUE(id, agreement_id) on agreement_amendments -- harmless
--      alongside its existing PK on id alone (id is already globally
--      unique; this composite unique exists purely so the pair can be
--      the target of a composite FK below).
--   2) Replace the simple FK on agreement_releases.effective_amendment_id
--      with a composite FK against (id, agreement_id). Postgres's default
--      MATCH SIMPLE semantics mean: if effective_amendment_id IS NULL,
--      the whole check is skipped (the "no amendment in effect yet"
--      case still works); if it IS set, agreement_id is always NOT NULL,
--      so the full pair must match a real row in agreement_amendments --
--      i.e. that amendment's actual agreement_id must equal this
--      release's own agreement_id, or the INSERT/UPDATE is rejected by
--      the database itself.
--
-- Rejected alternative: a Trigger (e.g. mirroring migration 118's
-- fn_validate_transfer_item_locations). A trigger is this project's
-- established tool for genuinely procedural/conditional business rules
-- that cannot be expressed declaratively (immutability guards, multi-
-- table hierarchy sequencing). This case is a plain "does this (id,
-- parent_id) pair exist" check -- exactly what composite FKs exist for.
-- Composite FK wins on Performance (native index lookup, no per-row
-- function call), Simplicity (zero procedural code), Maintainability
-- (nothing to read/debug beyond the constraint definition), and is more
-- consistent with this project's demonstrated philosophy of using
-- triggers sparingly (4 total across 132 prior migrations) and only
-- where a declarative constraint genuinely cannot express the rule.
--
-- ON DELETE RESTRICT (not SET NULL, unlike the original simple FK):
-- a composite FK's ON DELETE SET NULL would null out BOTH referenced
-- columns, including agreement_id -- but agreement_id is the release's
-- own core identity and must remain NOT NULL. RESTRICT matches the
-- existing precedent of agreement_releases.agreement_id -> agreements
-- ON DELETE RESTRICT (hard deletes never occur in practice; this
-- project is soft-delete only).
--
-- Written as a NEW migration rather than editing 132 in place, because
-- 132 has already been applied to the live database -- the migration
-- runner (migrate.ts) tracks applied migrations by filename only, not
-- by content checksum, so editing an already-applied file's SQL would
-- NOT be re-run and would silently diverge from the live schema. Same
-- safe pattern already used for 129 (a follow-up to 128).

ALTER TABLE agreement_amendments
  ADD CONSTRAINT uq_agreement_amendments_id_agreement UNIQUE (id, agreement_id);

ALTER TABLE agreement_releases
  DROP CONSTRAINT agreement_releases_effective_amendment_id_fkey;

ALTER TABLE agreement_releases
  ADD CONSTRAINT fk_agreement_releases_effective_amendment
  FOREIGN KEY (effective_amendment_id, agreement_id)
  REFERENCES agreement_amendments (id, agreement_id)
  ON DELETE RESTRICT;
