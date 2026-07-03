-- Phase 10D — expiration tracking + alerts (reporting only, same scope as reorder points:
-- surfaced via reports/dashboard, no automatic push/email alert yet).

CREATE OR REPLACE FUNCTION fn_batches_expiring_soon(
  p_tenant_id UUID,
  p_days_ahead INT DEFAULT 30
)
RETURNS TABLE (
  batch_id          UUID,
  item_id           UUID,
  variant_id        UUID,
  warehouse_id      UUID,
  item_name         TEXT,
  batch_number      TEXT,
  expiration_date   DATE,
  days_until_expiry INT,
  quantity_on_hand  NUMERIC,
  status            TEXT
) AS $$
  SELECT
    ib.id,
    ib.item_id,
    ib.variant_id,
    sl.warehouse_id,
    i.name,
    ib.batch_number,
    ib.expiration_date,
    (ib.expiration_date - CURRENT_DATE)::INT,
    COALESCE(sl.quantity_on_hand, 0),
    CASE
      WHEN ib.expiration_date < CURRENT_DATE THEN 'expired'
      WHEN ib.expiration_date <= CURRENT_DATE + p_days_ahead THEN 'expiring_soon'
      ELSE 'ok'
    END
  FROM item_batches ib
  JOIN items i ON i.id = ib.item_id
  LEFT JOIN stock_levels sl
    ON sl.tenant_id = ib.tenant_id
   AND sl.batch_id = ib.id
  WHERE ib.tenant_id = p_tenant_id
    AND ib.expiration_date IS NOT NULL
    AND ib.expiration_date <= CURRENT_DATE + p_days_ahead
    AND COALESCE(sl.quantity_on_hand, 0) > 0
  ORDER BY ib.expiration_date ASC;
$$ LANGUAGE sql STABLE;
