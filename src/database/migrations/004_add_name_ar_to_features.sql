ALTER TABLE features 
ADD COLUMN IF NOT EXISTS name_ar VARCHAR(100);

UPDATE features SET name_ar = 'نقطة البيع' WHERE key = 'pos';
UPDATE features SET name_ar = 'إدارة المخزون' WHERE key = 'inventory';
UPDATE features SET name_ar = 'إدارة المصروفات' WHERE key = 'expenses';
UPDATE features SET name_ar = 'إدارة الورديات' WHERE key = 'shifts';
UPDATE features SET name_ar = 'إدارة العملاء' WHERE key = 'customers';
UPDATE features SET name_ar = 'التقارير والتحليلات' WHERE key = 'reports';
UPDATE features SET name_ar = 'الإشعارات' WHERE key = 'notifications';
UPDATE features SET name_ar = 'تعدد الفروع' WHERE key = 'multi_branch';
UPDATE features SET name_ar = 'الفوترة والاشتراكات' WHERE key = 'billing';
UPDATE features SET name_ar = 'سجل المراجعة' WHERE key = 'audit_logs';