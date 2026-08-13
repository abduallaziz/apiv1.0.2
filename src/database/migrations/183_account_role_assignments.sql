-- Sefay Global Financial Platform — Migration M183
-- Account Role Assignments — per the Accounting Integration Audit §11
-- (Account Mapping Architecture) and §19 (Exact M183 Scope). This is the
-- foundation every future Sales/Purchasing/Inventory/Payment posting
-- integration will depend on: a fixed, versioned platform vocabulary of
-- "roles" a business event maps to (e.g. "this sale's revenue goes to
-- whichever account the tenant assigned the sales_revenue role"),
-- keeping posting logic portable across every tenant's differently
-- coded Chart of Accounts, and never hardcoding an account UUID.
--
-- Scope, exactly as approved — nothing else:
--   - account_roles: GLOBAL, versioned catalog (same pattern as M176's
--     accounting_owner_types) — no tenant_id, no RLS, zero tenant-owned
--     data.
--   - account_role_assignments: tenant-scoped, tenant_id + role_code +
--     account_id, composite tenant-safe FK to accounts(tenant_id, id),
--     UNIQUE(tenant_id, role_code) — one account per role per tenant.
--   - role_code is a plain FK to account_roles.code — an undefined role
--     is rejected by the database, not just application validation.
--
-- NOT in scope here: no posting logic, no Sales/Purchasing/Inventory
-- modification, no Payment/Tax/AR/AP tables, no new Journal/Journal
-- Line/Ledger object. M176–M182 are not modified. Inventory/WMS is
-- completely untouched.

-- ============================================================
-- account_roles — global, fixed platform vocabulary (M176 pattern)
-- ============================================================
CREATE TABLE account_roles (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO account_roles (code, label) VALUES
  ('sales_revenue',      'Sales Revenue'),
  ('inventory_asset',    'Inventory Asset'),
  ('cogs',               'Cost of Goods Sold'),
  ('accounts_receivable','Accounts Receivable'),
  ('accounts_payable',   'Accounts Payable'),
  ('tax_payable',        'Tax Payable'),
  ('default_cash',       'Default Cash Account'),
  ('default_bank',       'Default Bank Account');

GRANT SELECT ON public.account_roles TO service_role;

-- ============================================================
-- account_role_assignments — tenant-scoped mapping: which of a
-- Tenant's own Accounts fills each platform role.
-- ============================================================
CREATE TABLE account_role_assignments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_code  TEXT        NOT NULL REFERENCES account_roles(code),
  account_id UUID        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite, tenant-safe FK — the proven mechanism used throughout
  -- this Accounting Foundation: guarantees the assigned account belongs
  -- to the SAME tenant, at the database level, independent of RLS.
  CONSTRAINT fk_account_role_assignments_account
    FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),

  -- One account per role per tenant.
  CONSTRAINT uq_account_role_assignments_tenant_role UNIQUE (tenant_id, role_code)
);

CREATE INDEX idx_account_role_assignments_tenant ON account_role_assignments(tenant_id);

ALTER TABLE account_role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON account_role_assignments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.account_role_assignments TO service_role;

-- No seed data, no backfill: role assignments are configured on-demand
-- by each tenant when they enable Accounting — never pre-provisioned,
-- consistent with every prior Accounting Foundation migration.

-- Rollback (documented, not auto-executed):
-- DROP TABLE IF EXISTS account_role_assignments;
-- DROP TABLE IF EXISTS account_roles;
