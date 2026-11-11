-- Customer Domain Phase 3 (Owner-approved) — customer<->branch is a
-- many-valued, additive RELATIONSHIP, never exclusive ownership (the
-- approved architecture explicitly rejects a permanent customers.branch_id
-- ownership column). This table records every branch a customer has
-- established a relationship with, via creation context or transaction
-- activity. Rows are never deleted or transferred when a customer moves
-- between branches — relationships only ever accumulate.
CREATE TABLE customer_branch_relationships (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  customer_id   UUID        NOT NULL REFERENCES customers(id),
  branch_id     UUID        NOT NULL REFERENCES branches(id),
  source        TEXT        NOT NULL CHECK (source IN ('created', 'transaction')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_customer_branch_relationships_tenant_customer_branch
    UNIQUE (tenant_id, customer_id, branch_id)
);

CREATE INDEX idx_customer_branch_rel_customer
  ON customer_branch_relationships (tenant_id, customer_id);
CREATE INDEX idx_customer_branch_rel_branch
  ON customer_branch_relationships (tenant_id, branch_id);

ALTER TABLE customer_branch_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON customer_branch_relationships
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.customer_branch_relationships TO service_role;

-- Backfill from factual historical order data only (orders.customer_id +
-- orders.branch_id) — never a guess. Every distinct (customer, branch)
-- pair that has ever appeared together on an order becomes exactly one
-- relationship row, source='transaction', first_seen_at/last_seen_at
-- taken from that pair's earliest/latest order. Orders with a NULL
-- customer_id or NULL branch_id contribute no row (there is nothing
-- factual to record). Customers with zero qualifying orders correctly
-- receive zero relationship rows — never a guessed branch.
INSERT INTO customer_branch_relationships
  (tenant_id, customer_id, branch_id, source, first_seen_at, last_seen_at)
SELECT
  o.tenant_id,
  o.customer_id,
  o.branch_id,
  'transaction',
  MIN(o.created_at),
  MAX(o.created_at)
FROM orders o
WHERE o.customer_id IS NOT NULL
  AND o.branch_id IS NOT NULL
GROUP BY o.tenant_id, o.customer_id, o.branch_id
ON CONFLICT (tenant_id, customer_id, branch_id) DO NOTHING;
