-- =============================================================================
-- 076 — RLS policies for stock_levels/stock_movements, session-context path
-- =============================================================================
-- Same template as 075_rls_policies_session_context.sql. Both tables have
-- carried ENABLE ROW LEVEL SECURITY since 017_inventory_ledger.sql with zero
-- CREATE POLICY until now — meaning RLS was structurally inert for them.
-- Only takes effect for connections that ran SELECT set_config('app.tenant_id', ...)
-- via TenantSessionService (StockRepository.callApplyStockMovementPooled).
-- Still inert for SUPABASE_SERVICE_ROLE_KEY-based calls (supabase.module.ts).
-- =============================================================================

CREATE POLICY tenant_session_isolation ON stock_levels
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_session_isolation ON stock_movements
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
