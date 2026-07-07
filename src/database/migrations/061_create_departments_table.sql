-- Foundation stage (S3). Creates a normalized departments table so a future
-- department-level access scope can be enforced reliably via a FK, instead
-- of matching on the free-text users.department column (which has
-- inconsistent casing/spelling/language across existing rows).
--
-- IMPORTANT: this migration does NOT touch users.department, and does NOT
-- backfill any rows here. That is a deliberately separate, manually reviewed
-- migration once the distinct department values have been mapped (e.g.
-- "Finance" / "finance dept" / "المالية" -> one department row) to avoid
-- silently creating duplicate or mismatched department rows.
CREATE TABLE IF NOT EXISTS departments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
