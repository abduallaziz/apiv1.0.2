-- Purchasing #9.5.1 follow-up (review comment fix, not a new step):
-- two real gaps found reviewing migration 128 -- neither was a
-- deliberate design choice, both are cheap CHECK constraints matching
-- the style already used throughout this migration and the rest of the
-- project.

-- 1) Date integrity: expiration_date must never be before effective_date
-- when both are set. Either or both may be NULL (an open-ended or
-- not-yet-scheduled agreement).
ALTER TABLE agreements ADD CONSTRAINT chk_agreements_date_integrity
  CHECK (effective_date IS NULL OR expiration_date IS NULL OR expiration_date >= effective_date);

-- 2) Currency format validation: shallow ISO 4217 shape check only
-- (three uppercase letters) -- NOT a full lookup against real currency
-- codes. A dedicated `currencies` reference table is the correct next
-- step ONLY when Multi-Currency Framework Agreements are actually
-- built (a genuine future structural extension, per the earlier
-- architectural review) -- premature today, when this and
-- supplier_quotes.currency are the only two currency columns in the
-- entire 128-migration history.
ALTER TABLE agreements ADD CONSTRAINT chk_agreements_currency_format
  CHECK (currency ~ '^[A-Z]{3}$');
