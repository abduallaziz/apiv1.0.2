-- =============================================================================
-- 080 — RLS policies, session-context path: purchasing tables
-- =============================================================================
-- Same template as preceding migrations in this series. All four tables
-- carry a direct tenant_id column (verified against 018_purchasing_and_ops.sql).
-- =============================================================================

CREATE POLICY tenant_session_isolation ON purchase_orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON purchase_order_items
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON goods_receipts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON goods_receipt_items
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
