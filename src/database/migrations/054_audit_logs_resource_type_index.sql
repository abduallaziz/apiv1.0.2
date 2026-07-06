-- Supports the new HR audit summary card (today's counts by resource_type:
-- leave / payroll / attendance / employee) added to the dashboard. The
-- audit_logs table and its tenant/actor/action indexes already exist
-- (001_initial_schema.sql) — this only adds the missing index for
-- resource_type + created_at range scans, additive and backward compatible.
CREATE INDEX IF NOT EXISTS idx_audit_resource_type_date ON audit_logs(resource_type, created_at DESC);
