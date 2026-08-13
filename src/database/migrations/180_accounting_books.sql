-- Sefay Global Financial Platform — Migration M180
-- Accounting Book — the named container Journal Entries will post into
-- (M182+), per the Final Pre-Implementation Correction §1: "Ledger" is
-- not a table — it is the logical view over posted Journal Entries/
-- Lines. Accounting Book IS the real, minimal foundation table that
-- makes future multi-book support (Primary/Management/Statutory/
-- Adjustment) additive rows, never a schema redesign.
--
-- Scope, exactly as approved:
--   - accounting_books ONLY.
--   - Tenant-safe: composite FK to accounting_owners(tenant_id, id).
--   - Exactly one default (`Primary`) book per Accounting Owner,
--     created automatically the moment an Accounting Owner is created —
--     a database-level guarantee (trigger), not an application-only
--     convention, consistent with this project's "not app-only" rule
--     for financial integrity.
--   - book_type supports 'primary' | 'management' | 'statutory' |
--     'adjustment' now, so Management/Statutory/Adjustment books never
--     require a schema change later — only new rows.
--
-- NOT in scope here: no Ledger table (retired as a concept — see M177
-- history), no Accounts/Chart of Accounts, no Journal Entry, no Journal
-- Line, no posting engine, no COA. No M181 or later object is created.
-- Inventory/WMS is completely untouched.

CREATE TABLE accounting_books (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  accounting_owner_id UUID        NOT NULL,
  book_type           TEXT        NOT NULL CHECK (book_type IN ('primary', 'management', 'statutory', 'adjustment')),
  name                TEXT        NOT NULL,
  is_default          BOOLEAN     NOT NULL DEFAULT false,
  status              TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite, tenant-safe FK — same proven mechanism as every prior
  -- Accounting migration (M177/M178/M179): RLS does not substitute for
  -- this, since FK checks are not RLS-filtered.
  CONSTRAINT fk_accounting_books_owner
    FOREIGN KEY (tenant_id, accounting_owner_id) REFERENCES accounting_owners (tenant_id, id),

  -- Only a Primary book may be marked default — the default book is,
  -- by definition, the Primary book. Prevents a Management/Statutory/
  -- Adjustment book from ever being flagged default, which would make
  -- "the default book" ambiguous with "the Primary book" in future
  -- reporting/posting logic.
  CONSTRAINT chk_accounting_books_default_is_primary
    CHECK (is_default = false OR book_type = 'primary'),

  -- Tenant-safe composite-FK target for the future Journal Entry (M182),
  -- which will attach to a specific Book.
  CONSTRAINT uq_accounting_books_tenant_id UNIQUE (tenant_id, id)
);

-- Exactly one default (Primary) book per Accounting Owner — the anchor
-- Journal Entries attach to when no specific Book is chosen.
CREATE UNIQUE INDEX uq_accounting_books_owner_default ON accounting_books(tenant_id, accounting_owner_id) WHERE is_default = true;

-- At most one book of each type per Owner today — deliberately narrow:
-- if a genuine future need for multiple Management books per Owner
-- arises, that is a separate, small, additive migration relaxing this
-- specific constraint, not a reason to leave it unconstrained now.
CREATE UNIQUE INDEX uq_accounting_books_owner_type ON accounting_books(tenant_id, accounting_owner_id, book_type);

CREATE INDEX idx_accounting_books_tenant ON accounting_books(tenant_id);

ALTER TABLE accounting_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON accounting_books
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.accounting_books TO service_role;

-- ============================================================
-- Database-level guarantee: every Accounting Owner automatically gets
-- exactly one default Primary Book the moment it is created. This is
-- NOT an application-layer convention — it is enforced here so that an
-- Accounting Owner can never exist without a Primary Book to post into,
-- regardless of which code path created the Owner.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_create_default_accounting_book() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO accounting_books (tenant_id, accounting_owner_id, book_type, name, is_default)
  VALUES (NEW.tenant_id, NEW.id, 'primary', NEW.name || ' — Primary Book', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounting_owners_create_default_book
AFTER INSERT ON accounting_owners
FOR EACH ROW EXECUTE FUNCTION fn_create_default_accounting_book();

-- No seed data, no backfill: zero accounting_owners rows currently exist
-- in the live database (every prior validation run cleaned up its own
-- test data), so there is nothing to backfill. Every Accounting Owner
-- created from this point forward automatically receives its default
-- Primary Book via the trigger above.

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_accounting_owners_create_default_book ON accounting_owners;
-- DROP FUNCTION IF EXISTS fn_create_default_accounting_book();
-- DROP TABLE IF EXISTS accounting_books;
