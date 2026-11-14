-- 282_branch_catalog_promotions.sql  (Branch isolation P1 / Task 1 - D4, D5)
-- coupons, note_presets, loyalty_tiers become branch-owned (reward_definitions already has branch_id, migration 211;
-- it only needs an index, registered in 280). ADDITIVE; behaviour only changes for isolated tenants.
-- Legacy NULL-branch rows keep the old tenant-wide uniqueness via COALESCE(branch_id, nil uuid).
-- ROLLBACK: recreate idx_coupons_tenant_code_unique (tenant_id, UPPER(code)) WHERE deleted_at IS NULL and
--   idx_loyalty_tiers_tenant_name_unique (tenant_id, name) WHERE deleted_at IS NULL, then drop the new ones.

ALTER TABLE coupons       ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE note_presets  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE loyalty_tiers ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_coupons_tenant_branch       ON coupons (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_presets_tenant_branch  ON note_presets (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_tenant_branch ON loyalty_tiers (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reward_definitions_tenant_branch ON reward_definitions (tenant_id, branch_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_branch_code
  ON coupons (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), UPPER(code))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tiers_branch_name
  ON loyalty_tiers (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_coupons_tenant_code_unique;
DROP INDEX IF EXISTS idx_loyalty_tiers_tenant_name_unique;

INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('coupons', 'promotions (task 1)'),
  ('note_presets', 'promotions (task 1)'),
  ('loyalty_tiers', 'loyalty definitions (task 1)')
ON CONFLICT (table_name) DO NOTHING;
-- reward_definitions is already registered by migration 280.
