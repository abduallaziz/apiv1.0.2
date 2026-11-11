-- 197 — New Expenses Domain: Database Foundation (Step 2 of the approved
-- NEW EXPENSES Execution Protocol, "Approved – Proceed with Step 2:
-- Database Foundation"). Scope, exactly as locked across the full design
-- series (Product & Architecture Design -> Department Lock -> Storage/
-- Permissions/Module Coexistence Lock -> Quick Expense/POS Lock -> Final
-- Design Freeze).
--
-- NAME-COLLISION CORRECTION (Owner Decision, same day): the first attempt
-- at this migration used `expenses`/`expense_categories`, which collide
-- with Legacy Expenses' own live tables (`001_initial_schema.sql:606`,
-- `005_expense_categories.sql`) — that attempt failed atomically (rolled
-- back, zero schema change persisted, confirmed by direct query before
-- writing this corrected version). Owner decision: Option 2 — keep Legacy
-- table names completely unchanged (Legacy is frozen and still actively
-- serves Shift Reconciliation/Reports/Platform Analytics; renaming its
-- tables would require touching those live consumers, which is explicitly
-- forbidden). The New Expenses domain instead uses independent names:
-- `expenses_v2` and `expense_categories_v2`. The other 5 tables had no
-- collision and are unchanged from the original design.
--
--   1. expense_departments   — tenant-scoped master, real entity, not free text.
--   2. expense_categories_v2 — tenant-scoped master (fresh instance for the
--                              New domain only — does not touch, read, or
--                              reference Legacy's `expense_categories`).
--   3. expenses_v2            — the core record. branch_id/department_id/
--                              category_id are all NOT NULL by explicit
--                              Owner decision: "no NULL Department, no
--                              Unassigned, no backfill strategy."
--   4. expense_recurring_templates — department_id/category_id NOT NULL,
--                              same reasoning as #3 ("a template that could
--                              generate an invalid Expense is itself invalid").
--   5. expense_quick_definitions   — default_department_id/
--                              default_category_id remain NULLABLE
--                              (deliberately, per the locked design: a Quick
--                              Definition is configuration, not an Expense;
--                              the NOT NULL constraint lives on `expenses_v2`
--                              itself, not here). amount_mode/fixed_amount
--                              pairing enforced by CHECK, exactly per the
--                              locked "fixed -> fixed_amount required,
--                              variable -> fixed_amount NULL" rule. No third
--                              amount_mode value is representable.
--   6. expense_attachments    — metadata only; the actual file bytes live in
--                              Supabase Storage via the Step 1 reusable
--                              `StorageService` (src/shared/storage/), never
--                              referenced from SQL.
--   7. expense_activity       — append-only per-Expense history, distinct
--                              from the generic `audit_logs` table.
--
-- No table beyond this approved 7-table model is created.
--
-- Deactivate-not-delete: expense_departments/expense_categories_v2/
-- expense_quick_definitions all get a guard trigger blocking DELETE
-- unconditionally, matching the exact precedent already established for
-- `accounts` (181_accounts.sql) and `branch_accounting_assignments`
-- (178_branch_accounting_assignments.sql) in this codebase — is_active is
-- the only path, never a hard delete, so a historical Expense's Department/
-- Category reference can never be silently orphaned.
--
-- `expenses_v2` itself is NOT covered by any DB-level immutability trigger
-- here — per the locked design, operational edit/delete is governed by
-- application-layer status+permission rules, not a DB guard. Financial
-- immutability only applies once an Expense has produced a posted
-- Accounting journal entry, which does not exist yet (Accounting
-- integration is explicitly out of scope for this build).
--
-- RLS: every table gets the exact `tenant_session_isolation` policy shape
-- already used throughout M181-M191, for defense-in-depth consistency with
-- the rest of the schema.
--
-- Does NOT touch: Legacy Expenses (`expenses`/`expense_categories`/
-- `expense_templates` — completely untouched, unrenamed, unmodified, per
-- the Owner's explicit Option 2 decision), any Legacy consumer (Shift
-- Reconciliation / Reports / Platform Analytics), Accounting (no account
-- role, no journal function, no FK to `journal_entries`), G1, Model B, or
-- Multi-Role UI.

-- ============================================================
-- 1. expense_departments
-- ============================================================
CREATE TABLE expense_departments (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_expense_departments_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_expense_departments_tenant_active
  ON expense_departments (tenant_id, is_active);

ALTER TABLE expense_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_departments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_departments TO service_role;

-- ============================================================
-- 2. expense_categories_v2 (New domain's own instance — NOT Legacy's
--    `expense_categories`, which remains completely untouched)
-- ============================================================
CREATE TABLE expense_categories_v2 (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_expense_categories_v2_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_expense_categories_v2_tenant_active
  ON expense_categories_v2 (tenant_id, is_active);

ALTER TABLE expense_categories_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_categories_v2
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_categories_v2 TO service_role;

-- ============================================================
-- 3. expense_recurring_templates
-- (created before `expenses_v2` so `expenses_v2.recurring_template_id` can
-- FK it)
-- ============================================================
CREATE TABLE expense_recurring_templates (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id             UUID        NOT NULL REFERENCES branches(id),
  department_id         UUID        NOT NULL REFERENCES expense_departments(id),
  category_id           UUID        NOT NULL REFERENCES expense_categories_v2(id),
  title                 TEXT        NOT NULL,
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  tax_mode              TEXT        NOT NULL CHECK (tax_mode IN ('inclusive', 'exclusive')),
  payment_method        TEXT        NOT NULL,
  frequency             TEXT        NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  start_date            DATE        NOT NULL,
  end_date              DATE,
  next_occurrence_date  DATE        NOT NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_expense_recurring_templates_end_after_start
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_expense_recurring_templates_due
  ON expense_recurring_templates (tenant_id, is_active, next_occurrence_date);

ALTER TABLE expense_recurring_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_recurring_templates
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_recurring_templates TO service_role;

-- ============================================================
-- 4. expense_quick_definitions
-- ============================================================
CREATE TABLE expense_quick_definitions (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label                   TEXT        NOT NULL,
  default_category_id     UUID        REFERENCES expense_categories_v2(id),
  default_department_id   UUID        REFERENCES expense_departments(id),
  amount_mode             TEXT        NOT NULL CHECK (amount_mode IN ('fixed', 'variable')),
  fixed_amount            NUMERIC(12,2),
  default_payment_method  TEXT,
  sort_order              INTEGER     NOT NULL DEFAULT 0,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  created_by              UUID        REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Locked pairing rule: fixed -> fixed_amount required; variable ->
  -- fixed_amount must be NULL. No other amount_mode value is possible
  -- (enforced by the CHECK on amount_mode itself, above).
  CONSTRAINT chk_expense_quick_definitions_amount_pairing CHECK (
    (amount_mode = 'fixed' AND fixed_amount IS NOT NULL)
    OR (amount_mode = 'variable' AND fixed_amount IS NULL)
  )
);

CREATE INDEX idx_expense_quick_definitions_tenant_active_sort
  ON expense_quick_definitions (tenant_id, is_active, sort_order);

ALTER TABLE expense_quick_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_quick_definitions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_quick_definitions TO service_role;

-- ============================================================
-- 5. expenses_v2 (core record — NOT Legacy's `expenses`, which remains
--    completely untouched)
-- ============================================================
CREATE TABLE expenses_v2 (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id              UUID        NOT NULL REFERENCES branches(id),
  department_id          UUID        NOT NULL REFERENCES expense_departments(id),
  category_id            UUID        NOT NULL REFERENCES expense_categories_v2(id),
  title                  TEXT        NOT NULL,
  description            TEXT,
  amount                 NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  tax_mode               TEXT        NOT NULL CHECK (tax_mode IN ('inclusive', 'exclusive')),
  tax_amount              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount            NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  payment_method          TEXT        NOT NULL,
  payment_status          TEXT        NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'unpaid')),
  approval_status         TEXT        NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved', 'pending_action', 'accepted', 'rejected')),
  reference_number        TEXT,
  source                  TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'quick', 'recurring', 'pos')),
  recurring_template_id   UUID        REFERENCES expense_recurring_templates(id),
  -- Optional shift linkage for the future Shift Reconciliation contract
  -- (documented in the design series, not built now) — populated correctly
  -- going forward, unlike Legacy Expenses' own disclosed-broken shift_id
  -- column. Legacy's `shifts` table is read-only referenced here (FK only,
  -- no write path to Legacy).
  shift_id                UUID        REFERENCES shifts(id),
  created_by               UUID        REFERENCES users(id),
  resolved_by               UUID        REFERENCES users(id),
  resolved_at               TIMESTAMPTZ,
  cancelled_by               UUID        REFERENCES users(id),
  cancelled_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_v2_tenant_branch     ON expenses_v2 (tenant_id, branch_id);
CREATE INDEX idx_expenses_v2_tenant_department ON expenses_v2 (tenant_id, department_id);
CREATE INDEX idx_expenses_v2_tenant_category   ON expenses_v2 (tenant_id, category_id);
CREATE INDEX idx_expenses_v2_tenant_created_at ON expenses_v2 (tenant_id, created_at);
CREATE INDEX idx_expenses_v2_tenant_payment_status ON expenses_v2 (tenant_id, payment_status);

ALTER TABLE expenses_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expenses_v2
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expenses_v2 TO service_role;

-- ============================================================
-- 6. expense_attachments (metadata only — files live in Supabase Storage
--    via the Step 1 StorageService, never referenced from SQL)
-- ============================================================
CREATE TABLE expense_attachments (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id    UUID        NOT NULL REFERENCES expenses_v2(id) ON DELETE CASCADE,
  file_url      TEXT        NOT NULL,
  storage_path  TEXT        NOT NULL,
  file_type     TEXT        NOT NULL,
  uploaded_by   UUID        REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_attachments_expense ON expense_attachments (expense_id);

ALTER TABLE expense_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_attachments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_attachments TO service_role;

-- ============================================================
-- 7. expense_activity (append-only per-Expense history, distinct from
--    audit_logs)
-- ============================================================
CREATE TABLE expense_activity (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id  UUID        NOT NULL REFERENCES expenses_v2(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES users(id),
  action      TEXT        NOT NULL CHECK (action IN (
                'created', 'edited', 'payment_confirmed', 'cancelled',
                'accepted', 'rejected', 'department_changed'
              )),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_activity_expense ON expense_activity (expense_id, created_at);

ALTER TABLE expense_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON expense_activity
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.expense_activity TO service_role;

-- ============================================================
-- Deactivate-not-delete guard — expense_departments, expense_categories_v2,
-- expense_quick_definitions. Matches the exact unconditional-DELETE-block
-- precedent already established for `accounts` (181_accounts.sql).
-- ============================================================
CREATE OR REPLACE FUNCTION fn_block_expense_master_data_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Cannot delete %. Deactivate it (is_active = false) instead — historical Expense references must never be orphaned.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_departments_no_delete
  BEFORE DELETE ON expense_departments
  FOR EACH ROW EXECUTE FUNCTION fn_block_expense_master_data_delete();

CREATE TRIGGER trg_expense_categories_v2_no_delete
  BEFORE DELETE ON expense_categories_v2
  FOR EACH ROW EXECUTE FUNCTION fn_block_expense_master_data_delete();

CREATE TRIGGER trg_expense_quick_definitions_no_delete
  BEFORE DELETE ON expense_quick_definitions
  FOR EACH ROW EXECUTE FUNCTION fn_block_expense_master_data_delete();

-- Rollback (documented, not auto-executed):
-- DROP TRIGGER IF EXISTS trg_expense_departments_no_delete ON expense_departments;
-- DROP TRIGGER IF EXISTS trg_expense_categories_v2_no_delete ON expense_categories_v2;
-- DROP TRIGGER IF EXISTS trg_expense_quick_definitions_no_delete ON expense_quick_definitions;
-- DROP FUNCTION IF EXISTS fn_block_expense_master_data_delete();
-- DROP TABLE IF EXISTS expense_activity;
-- DROP TABLE IF EXISTS expense_attachments;
-- DROP TABLE IF EXISTS expenses_v2;
-- DROP TABLE IF EXISTS expense_quick_definitions;
-- DROP TABLE IF EXISTS expense_recurring_templates;
-- DROP TABLE IF EXISTS expense_categories_v2;
-- DROP TABLE IF EXISTS expense_departments;
