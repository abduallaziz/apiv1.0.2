-- 252. Order cancellation fields (Phase 3a of DESIGN-REVIEW-REGISTER-CLOSE-2026-11-09,
-- owner approved). Until now an order's cancellation reason, time and actor
-- lived only inside audit_logs.after_data; the order row itself said only
-- status = 'cancelled'. These columns make "who cancelled it, when and why"
-- a first-class, reportable fact (cancelled figures in every report).
--
-- Purely additive: three nullable columns. Existing cancelled orders are
-- backfilled from their own 'invoice.cancel' audit row (latest one per
-- order); a cancelled order with no audit row simply keeps NULLs.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by   UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

UPDATE orders o
SET cancelled_at  = a.created_at,
    cancelled_by  = a.actor_id,
    cancel_reason = NULLIF(a.after_data ->> 'reason', '')
FROM (
  SELECT DISTINCT ON (resource_id) resource_id, created_at, actor_id, after_data
  FROM audit_logs
  WHERE action = 'invoice.cancel'
  ORDER BY resource_id, created_at DESC
) a
WHERE o.status = 'cancelled'
  AND o.cancelled_at IS NULL
  AND a.resource_id = o.id::text;

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
  ON orders (tenant_id, cancelled_at)
  WHERE status = 'cancelled';
