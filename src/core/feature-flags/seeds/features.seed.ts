import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const FEATURES = [
  { key: 'pos', name: 'Point of Sale', category: 'core', is_enabled: true },
  { key: 'inventory', name: 'Inventory Management', category: 'core', is_enabled: true },
  { key: 'expenses', name: 'Expenses', category: 'core', is_enabled: true },
  { key: 'shifts', name: 'Shift Management', category: 'core', is_enabled: true },
  { key: 'customers', name: 'Customer Management', category: 'core', is_enabled: true },
  { key: 'coupons', name: 'Coupons & Discounts', category: 'advanced', is_enabled: true },
  { key: 'appointments', name: 'Appointments', category: 'advanced', is_enabled: false },
  { key: 'analytics', name: 'Advanced Analytics', category: 'premium', is_enabled: false },
  { key: 'multi_branch', name: 'Multi Branch', category: 'advanced', is_enabled: true },
  { key: 'reports_export', name: 'Reports Export', category: 'advanced', is_enabled: false },
];

async function seed() {
  const { error } = await supabase
    .from('features')
    .upsert(FEATURES, { onConflict: 'key' });

  if (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }

  console.log('Features seeded ✅');
}

seed();