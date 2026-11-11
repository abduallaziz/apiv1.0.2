-- Branch System Step 5 — Audit Log branch context (Owner-approved).
--
-- Nullable, tenant-scoped FK to branches. Two distinct meanings share the
-- same NULL value, deliberately — this migration does not (and cannot)
-- disambiguate them at the schema level, only in how rows are produced:
--   - EXISTING rows as of this migration: branch is genuinely UNKNOWN.
--     There is no reliable historical source (actor_id -> users.branch_id
--     would give a *current*, not historical, answer and was explicitly
--     rejected as a substitute) — so these are left NULL rather than
--     guessed. No backfill is performed.
--   - NEW rows going forward, written with branch_id = NULL: the audited
--     action is genuinely tenant-wide (authentication, user/role
--     administration, subscription/billing, BOM/quality-rule/template
--     definitions, superadmin actions, etc.) or its resource has no
--     reliable branch path yet (payroll adjustments, leave requests,
--     non-conformances, corrective actions, quality deviations — tracked
--     as a separate, later architectural decision, not solved here).
-- Both cases are legitimate NULL; neither means "Central" as a business
-- concept — audit_logs.branch_id NULL is "no known branch for this row",
-- not a statement about the actor's own branch assignment.
ALTER TABLE audit_logs
  ADD COLUMN branch_id UUID REFERENCES branches(id);

-- Supports GET /reports/audit-summary's eventual
-- WHERE tenant_id = ? AND branch_id = ? AND created_at >= ? shape (not
-- implemented in this migration — Reports itself is explicitly out of
-- scope here). A partial/full composite serves both the tenant-wide case
-- (branch_id IS NULL or omitted from the WHERE) and the branch-scoped case.
CREATE INDEX idx_audit_logs_tenant_branch_time
  ON audit_logs (tenant_id, branch_id, created_at);
