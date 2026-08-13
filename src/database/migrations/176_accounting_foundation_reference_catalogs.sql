-- Sefay Global Financial Platform — Migration M176
-- Foundation: PostgreSQL extension + the two GLOBAL reference catalogs
-- approved across the Financial Core architecture review series
-- (Domain/Entity Audit, Coexistence Gate, Database Architecture
-- Specification, Final Schema Integrity Review, Pre-Migration
-- Clarification, Final Pre-Implementation Fix Gate).
--
-- Scope: exactly M176 as approved. No Company, Accounting Owner, Branch
-- Assignment, Ledger, or any other Financial Core object is created here.
-- Inventory/WMS is untouched — this migration creates no FK to, and
-- modifies no column on, any existing Sefay table.
--
-- accounting_owner_types / financial_event_source_types are deliberately
-- GLOBAL (no tenant_id, no RLS) — they carry zero tenant-owned data
-- (every tenant means exactly the same thing by 'branch'/'central'/etc.,
-- and by the Sales/order or Purchasing/goods_receipt pairing), so there is
-- no tenant-scoped content to isolate. This is the corrected design from
-- the Final Pre-Migration Clarification, which withdrew an earlier,
-- incorrect composite-FK-on-tenant_id proposal for these two tables.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- accounting_owner_types — global, fixed platform semantic labels
-- ============================================================
CREATE TABLE accounting_owner_types (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO accounting_owner_types (code, label) VALUES
  ('branch',   'Independent Branch Accounting'),
  ('central',  'Central Accounting'),
  ('regional', 'Regional Accounting'),
  ('other',    'Other Accounting Structure');

GRANT SELECT ON public.accounting_owner_types TO service_role;

-- ============================================================
-- financial_event_source_types — global, extensible catalog of
-- (source_module, source_entity_type) pairs a Financial Event may
-- reference. Extending this later (a new operational source) is a plain
-- INSERT, never a migration.
-- ============================================================
CREATE TABLE financial_event_source_types (
  source_module      TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  label              TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_module, source_entity_type)
);

INSERT INTO financial_event_source_types (source_module, source_entity_type, label) VALUES
  ('sales',         'order',            'POS Sale / Order'),
  ('purchasing',    'goods_receipt',    'Goods Receipt'),
  ('inventory',     'stock_movement',   'Inventory Stock Movement'),
  ('manufacturing', 'production_order', 'Production Order Completion'),
  ('expenses',      'expense',          'Expense Entry');

GRANT SELECT ON public.financial_event_source_types TO service_role;

-- Rollback (documented, not auto-executed):
-- DROP TABLE IF EXISTS financial_event_source_types;
-- DROP TABLE IF EXISTS accounting_owner_types;
-- DROP EXTENSION IF EXISTS btree_gist; -- only if nothing else uses it
