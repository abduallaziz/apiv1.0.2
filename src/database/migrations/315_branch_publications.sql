-- 315_branch_publications.sql  (Branch isolation P7 — docs/DESIGN_BRANCH_ISOLATION.md D8 / section 7)
-- Provenance of "publish to branches": one row per (entity type, source record, target branch) so that
-- re-publishing updates/skips instead of duplicating. Polymorphic ids on purpose (no FK to the entity tables).
-- ADDITIVE and idempotent.
-- ROLLBACK: DROP TABLE IF EXISTS branch_publications;

CREATE TABLE IF NOT EXISTS branch_publications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  entity_type      TEXT        NOT NULL,
  source_id        UUID        NOT NULL,
  source_branch_id UUID        NOT NULL REFERENCES branches(id),
  target_branch_id UUID        NOT NULL REFERENCES branches(id),
  target_id        UUID        NOT NULL,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_publications_source_target
  ON branch_publications (tenant_id, entity_type, source_id, target_branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_publications_target
  ON branch_publications (tenant_id, target_branch_id, entity_type);

GRANT ALL PRIVILEGES ON public.branch_publications TO service_role;
