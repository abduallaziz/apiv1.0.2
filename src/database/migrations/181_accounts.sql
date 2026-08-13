-- Sefay Global Financial Platform — Migration M181
-- Accounts — this table IS the Chart of Accounts. Per the Final
-- Pre-Implementation Correction §4: there is no separate
-- `chart_of_accounts` table/entity. "Chart of Accounts" is simply the
-- name for the set of a Tenant's `accounts` rows, exactly the same
-- relationship as "Journal" names `journal_entries`+`journal_lines`.
--
-- Scope, exactly as approved:
--   - accounts ONLY. No chart_of_accounts table.
--   - Tenant-scoped (one COA per Tenant, decisively — matches
--     Tenant=Company: exactly one legal entity, exactly one chart).
--   - Self-referencing hierarchy via parent_account_id, with database-
--     level cycle prevention (a trigger, not merely a FK) and a rule
--     that a parent account can never itself be a posting account —
--     a header/parent account is definitionally non-posting.
--   - Accounts are never deleted (Journal Lines will reference them
--     historically once M182 exists) — deactivation (`is_active =
--     false`) is the only removal path, enforced by a guard trigger
--     blocking DELETE unconditionally.
--   - System accounts (`is_system_account = true`) additionally cannot
--     have their protected fields changed or be deactivated.
--   - Shared across all future Accounting Books for a Tenant — no
--     per-book COA, avoiding a combinatorial explosion later.
--
-- NOT in scope here: no Journal Entry, no Journal Line, no posting
-- engine, no Ledger table (retired as a concept), no Fiscal object
-- (M179 already exists and is untouched), no Dimensions. No M182 or
-- later object is created. Inventory/WMS is completely untouched.

CREATE TABLE accounts (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_account_id   UUID,
  code                TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  account_type        TEXT        NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance      TEXT        NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_posting_account  BOOLEAN     NOT NULL DEFAULT true,
  is_system_account   BOOLEAN     NOT NULL DEFAULT false,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  sort_order          INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Account code is unique within a Tenant's single Chart of Accounts.
  CONSTRAINT uq_accounts_tenant_code UNIQUE (tenant_id, code),

  -- Tenant-safe composite-FK target for the future Journal Line (M182),
  -- which will reference a specific Account.
  CONSTRAINT uq_accounts_tenant_id UNIQUE (tenant_id, id),

  -- Self-referencing, tenant-safe composite FK for the hierarchy — an
  -- account's parent must exist and belong to the SAME tenant. This
  -- catches cross-tenant parent assignment at the database level; the
  -- guard trigger below additionally catches same-tenant cycles, which
  -- no FK (composite or otherwise) can express.
  CONSTRAINT fk_accounts_parent
    FOREIGN KEY (tenant_id, parent_account_id) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX idx_accounts_tenant ON accounts(tenant_id);
CREATE INDEX idx_accounts_tenant_parent ON accounts(tenant_id, parent_account_id);
CREATE INDEX idx_accounts_tenant_type ON accounts(tenant_id, account_type);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON accounts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.accounts TO service_role;

-- ============================================================
-- Database-level integrity guard — DELETE is always blocked (accounts
-- are never deleted); system-account protected fields and active-state
-- cannot be changed; a parent account can never be a posting account;
-- an account cannot be marked posting while it still has children;
-- hierarchy cycles are rejected by walking the parent chain.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_guard_accounts_mutation() RETURNS TRIGGER AS $$
DECLARE
  v_parent_is_posting BOOLEAN;
  v_has_children      BOOLEAN;
  v_current           UUID;
  v_depth             INTEGER := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accounts are never deleted — Journal Lines may reference them historically. Deactivate (is_active = false) instead.';
  END IF;

  -- System-account protection (UPDATE only; OLD exists).
  IF TG_OP = 'UPDATE' AND OLD.is_system_account = true THEN
    IF NEW.is_system_account IS DISTINCT FROM OLD.is_system_account
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance THEN
      RAISE EXCEPTION 'System account % (%) protected fields cannot be changed', OLD.code, OLD.id;
    END IF;
    IF OLD.is_active = true AND NEW.is_active = false THEN
      RAISE EXCEPTION 'System account % (%) cannot be deactivated', OLD.code, OLD.id;
    END IF;
  END IF;

  -- Hierarchy validation (INSERT and UPDATE): self-parent, cross-tenant
  -- already caught by the composite FK, parent-must-be-non-posting, and
  -- cycle detection by walking the parent chain.
  IF NEW.parent_account_id IS NOT NULL THEN
    IF NEW.parent_account_id = NEW.id THEN
      RAISE EXCEPTION 'An account cannot be its own parent';
    END IF;

    SELECT is_posting_account INTO v_parent_is_posting
    FROM accounts WHERE id = NEW.parent_account_id AND tenant_id = NEW.tenant_id;

    IF v_parent_is_posting IS TRUE THEN
      RAISE EXCEPTION 'Parent account % is a posting account and cannot have child accounts — mark it non-posting first', NEW.parent_account_id;
    END IF;

    v_current := NEW.parent_account_id;
    WHILE v_current IS NOT NULL LOOP
      v_depth := v_depth + 1;
      IF v_depth > 100 THEN
        RAISE EXCEPTION 'Account hierarchy exceeds maximum supported depth (100)';
      END IF;
      IF v_current = NEW.id THEN
        RAISE EXCEPTION 'Setting parent_account_id would create a hierarchy cycle';
      END IF;
      SELECT parent_account_id INTO v_current FROM accounts WHERE id = v_current AND tenant_id = NEW.tenant_id;
    END LOOP;
  END IF;

  -- A parent (header) account can never be flagged posting while it
  -- still has children — a posting account is by definition a leaf.
  IF NEW.is_posting_account = true THEN
    SELECT EXISTS(
      SELECT 1 FROM accounts WHERE parent_account_id = NEW.id AND tenant_id = NEW.tenant_id
    ) INTO v_has_children;
    IF v_has_children THEN
      RAISE EXCEPTION 'Account % has child accounts and cannot be marked as a posting account', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION fn_guard_accounts_mutation();

-- No seed data, no backfill: Accounts (including any system accounts
-- such as Retained Earnings) are created on-demand when a tenant
-- actually enables Accounting — never pre-provisioned, consistent with
-- every prior Accounting Foundation migration.

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_accounts_guard ON accounts;
-- DROP FUNCTION IF EXISTS fn_guard_accounts_mutation();
-- DROP TABLE IF EXISTS accounts;
