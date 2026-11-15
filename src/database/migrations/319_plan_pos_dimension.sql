-- 319_plan_pos_dimension.sql  (POS registers as a plan dimension — approved 2026-11-15)
-- max_pos = registers included in a plan; extra_pos add-on buys more (tenant-wide pool, like branches/users).
-- ADDITIVE and idempotent. Default max_pos=1 covers every existing tenant; seeded per the agreed table.
-- ROLLBACK: remove 'extra_pos' from addons_type_check; DELETE FROM addons WHERE key='extra_pos';
--           ALTER TABLE plans DROP COLUMN max_pos;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_pos INTEGER NOT NULL DEFAULT 1;

-- Agreed allowance per plan (editable later from the super-admin screen). Matched by name; unknown plans keep 1.
UPDATE plans SET max_pos = 1 WHERE name IN ('Basic', 'Standard');
UPDATE plans SET max_pos = 3 WHERE name = 'Pro';
UPDATE plans SET max_pos = 5 WHERE name = 'Enterprise';

-- addons.type gains 'extra_pos'.
ALTER TABLE addons DROP CONSTRAINT IF EXISTS addons_type_check;
ALTER TABLE addons ADD CONSTRAINT addons_type_check
  CHECK (type IN ('extra_user', 'extra_branch', 'extra_pos', 'feature'));

INSERT INTO addons (key, type, name_ar, name_en, sort_order) VALUES
  ('extra_pos', 'extra_pos', 'نقطة بيع إضافية', 'Extra POS register', 3)
ON CONFLICT (key) DO NOTHING;
