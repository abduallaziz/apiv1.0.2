-- Purchasing #9.3 Document Lifecycle review follow-up: every purchasing
-- document (PR, RFQ, Award, PO, Goods Receipt) has its own independent
-- number — Supplier Quote was the one exception. The number belongs on
-- `quote_groups`, not `supplier_quotes`: quote_groups IS the stable
-- document identity (one per RFQ+supplier), while supplier_quotes rows
-- are that document's revisions/versions — the number stays the same
-- across every version, exactly like a document number stays the same
-- across amendments.
--
-- Confirmed live before this migration: zero existing quote_groups rows
-- (feature shipped this session, no real usage yet), so NOT NULL can be
-- added directly with no backfill needed.

ALTER TABLE quote_groups ADD COLUMN quote_number TEXT NOT NULL;
CREATE UNIQUE INDEX uq_quote_groups_tenant_number ON quote_groups(tenant_id, quote_number);
