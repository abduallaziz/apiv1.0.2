ALTER TABLE features 
ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'core' 
CHECK (category IN ('core', 'advanced', 'premium'));

UPDATE features SET category = 'core' WHERE key IN ('pos', 'expenses', 'shifts', 'customers');
UPDATE features SET category = 'advanced' WHERE key IN ('reports', 'notifications', 'multi_branch');
UPDATE features SET category = 'premium' WHERE key IN ('billing', 'audit_logs');