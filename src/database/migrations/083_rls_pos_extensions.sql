-- =============================================================================
-- 083 — Enable RLS + policy, POS extension features (bundled)
-- =============================================================================
-- Same verification as 082: none of these 4 tables are realtime-published,
-- none are queried outside SUPABASE_SERVICE_ROLE_KEY. `customer_field_definitions`
-- is the dynamic-custom-fields feature (the one audited for overstatement much
-- earlier in this initiative — still customers-only, that finding is
-- unrelated to and unaffected by this RLS work).
-- =============================================================================

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON coupons
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON gift_cards
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON loyalty_tiers
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE customer_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON customer_field_definitions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
