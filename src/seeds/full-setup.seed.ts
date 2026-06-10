import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function seed() {
  console.log('🚀 Starting full setup seed...\n');

  // ===== 1. PERMISSIONS =====
  console.log('1️⃣  Seeding permissions...');
  const permissions = [
    { name: 'invoice.create.own', resource: 'invoice', action: 'create', description: 'Create own invoices' },
    { name: 'invoice.view.own', resource: 'invoice', action: 'view', description: 'View own invoices' },
    { name: 'invoice.view.branch', resource: 'invoice', action: 'view', description: 'View branch invoices' },
    { name: 'invoice.view.all', resource: 'invoice', action: 'view', description: 'View all invoices' },
    { name: 'invoice.cancel.own', resource: 'invoice', action: 'cancel', description: 'Cancel own invoices' },
    { name: 'invoice.cancel.branch', resource: 'invoice', action: 'cancel', description: 'Cancel branch invoices' },
    { name: 'expense.request', resource: 'expense', action: 'request', description: 'Submit expense requests' },
    { name: 'expense.view.branch', resource: 'expense', action: 'view', description: 'View branch expenses' },
    { name: 'expense.view.all', resource: 'expense', action: 'view', description: 'View all expenses' },
    { name: 'expense.approve', resource: 'expense', action: 'approve', description: 'Approve expenses' },
    { name: 'expense.reject', resource: 'expense', action: 'reject', description: 'Reject expenses' },
    { name: 'shift.open', resource: 'shift', action: 'open', description: 'Open a shift' },
    { name: 'shift.close', resource: 'shift', action: 'close', description: 'Close own shift' },
    { name: 'shift.view.own', resource: 'shift', action: 'view', description: 'View own shift' },
    { name: 'shift.view.branch', resource: 'shift', action: 'view', description: 'View branch shifts' },
    { name: 'shift.view.all', resource: 'shift', action: 'view', description: 'View all shifts' },
    { name: 'users.view', resource: 'users', action: 'view', description: 'View users' },
    { name: 'users.manage', resource: 'users', action: 'manage', description: 'Manage users' },
    { name: 'items.manage', resource: 'items', action: 'manage', description: 'Manage items' },
    { name: 'branches.manage', resource: 'branches', action: 'manage', description: 'Manage branches' },
    { name: 'reports.view.branch', resource: 'reports', action: 'view', description: 'View branch reports' },
    { name: 'reports.view.all', resource: 'reports', action: 'view', description: 'View all reports' },
    { name: 'settings.view', resource: 'settings', action: 'view', description: 'View settings' },
    { name: 'settings.manage', resource: 'settings', action: 'manage', description: 'Manage settings' },
    { name: 'analytics.view.all', resource: 'analytics', action: 'view', description: 'View platform analytics' },
    { name: 'audit.view.all', resource: 'audit', action: 'view', description: 'View audit logs' },
    { name: 'superadmin.queue.view', resource: 'superadmin', action: 'queue.view', description: 'View queues' },
    { name: 'superadmin.queue.manage', resource: 'superadmin', action: 'queue.manage', description: 'Manage queues' },
    { name: 'superadmin.health.view', resource: 'superadmin', action: 'health.view', description: 'View health' },
    { name: 'superadmin.backup.view', resource: 'superadmin', action: 'backup.view', description: 'View backup' },
  ];

  const { error: permError } = await supabase
    .from('permissions')
    .upsert(permissions, { onConflict: 'name' });
  if (permError) { console.error('❌ permissions:', permError.message); process.exit(1); }
  console.log(`   ✓ ${permissions.length} permissions`);

  // ===== 2. ROLE_PERMISSIONS =====
  console.log('2️⃣  Seeding role_permissions...');
  const rolePerms: { role: string; permission_key: string; is_granted: boolean }[] = [];
  const add = (role: string, keys: string[]) =>
    keys.forEach(k => rolePerms.push({ role, permission_key: k, is_granted: true }));

  add('superadmin', ['analytics.view.all','audit.view.all','invoice.view.all','expense.view.all','expense.approve','expense.reject','shift.view.all','users.manage','branches.manage','items.manage','reports.view.all','settings.manage','superadmin.queue.view','superadmin.queue.manage','superadmin.health.view','superadmin.backup.view']);
  add('owner', ['invoice.create.own','invoice.cancel.branch','invoice.view.all','expense.approve','expense.reject','expense.view.all','shift.open','shift.close','shift.view.all','users.manage','branches.manage','items.manage','reports.view.all','settings.view','settings.manage']);
  add('manager', ['invoice.create.own','invoice.view.branch','expense.view.branch','shift.open','shift.close','shift.view.branch','users.view','items.manage','reports.view.branch','settings.view']);
  add('cashier', ['invoice.create.own','invoice.view.own','expense.request','shift.open','shift.close','shift.view.own']);
  add('worker', ['invoice.view.own','shift.view.own']);

  const { error: rpError } = await supabase
    .from('role_permissions')
    .upsert(rolePerms, { onConflict: 'role,permission_key' });
  if (rpError) { console.error('❌ role_permissions:', rpError.message); process.exit(1); }
  console.log(`   ✓ ${rolePerms.length} role_permissions`);

  // ===== 3. SUPERADMIN USER =====
  console.log('3️⃣  Creating superadmin user...');
  const superadminHash = await bcrypt.hash('123456', 12);
  const { data: superadmin, error: saError } = await supabase
    .from('users')
    .upsert({
      email: 'admin@sefay.com',
      password_hash: superadminHash,
      name: 'Super Admin',
      role: 'superadmin',
      tenant_id: null,
      is_active: true,
    }, { onConflict: 'email' })
    .select('id')
    .single();
  if (saError) { console.error('❌ superadmin:', saError.message); process.exit(1); }
  console.log(`   ✓ superadmin: admin@sefay.com / 123456`);

  // ===== 4. PLAN =====
  console.log('4️⃣  Creating plan...');
  const { data: plan, error: planError } = await supabase
    .from('plans')
    .upsert({
      name: 'Enterprise',
      description: 'Full access plan',
      price_monthly: 299,
      price_yearly: 2990,
      max_users: 100,
      max_branches: 50,
      trial_days: 14,
      is_active: true,
    }, { onConflict: 'name' })
    .select('id')
    .single();
  if (planError) { console.error('❌ plan:', planError.message); process.exit(1); }
  console.log(`   ✓ plan: Enterprise`);

  // ===== 5. FEATURES =====
  console.log('5️⃣  Seeding features...');
  const features = [
    { key: 'pos', name: 'Point of Sale', is_enabled: true },
    { key: 'inventory', name: 'Inventory Management', is_enabled: true },
    { key: 'expenses', name: 'Expense Management', is_enabled: true },
    { key: 'shifts', name: 'Shift Management', is_enabled: true },
    { key: 'customers', name: 'Customer Management', is_enabled: true },
    { key: 'reports', name: 'Reports & Analytics', is_enabled: true },
    { key: 'notifications', name: 'Notifications', is_enabled: true },
    { key: 'billing', name: 'Billing & Subscriptions', is_enabled: true },
    { key: 'multi_branch', name: 'Multi Branch', is_enabled: true },
    { key: 'audit_logs', name: 'Audit Logs', is_enabled: true },
  ];
  const { error: featError } = await supabase
    .from('features')
    .upsert(features, { onConflict: 'key' });
  if (featError) { console.error('❌ features:', featError.message); process.exit(1); }

  // plan_features — كل الميزات مفعّلة للـ Enterprise
  const planFeatures = features.map(f => ({
    plan_id: plan!.id,
    feature_key: f.key,
    is_enabled: true,
  }));
  const { error: pfError } = await supabase
    .from('plan_features')
    .upsert(planFeatures, { onConflict: 'plan_id,feature_key' });
  if (pfError) { console.error('❌ plan_features:', pfError.message); process.exit(1); }
  console.log(`   ✓ ${features.length} features + plan_features`);

  // ===== 6. TENANT =====
  console.log('6️⃣  Creating tenant...');
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .upsert({
      name: 'Sefay Demo',
      business_type: 'retail',
      status: 'active',
      default_language: 'ar',
      timezone: 'Asia/Riyadh',
      currency: 'SAR',
      trial_ends_at: trialEndsAt.toISOString(),
    }, { onConflict: 'name' })
    .select('id')
    .single();
  if (tenantError) { console.error('❌ tenant:', tenantError.message); process.exit(1); }
  console.log(`   ✓ tenant: Sefay Demo`);

  // ===== 7. SUBSCRIPTION =====
  console.log('7️⃣  Creating subscription...');
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error: subError } = await supabase
    .from('subscriptions')
    .upsert({
      tenant_id: tenant!.id,
      plan_id: plan!.id,
      status: 'active',
      billing_cycle: 'monthly',
      started_at: new Date().toISOString(),
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
    }, { onConflict: 'tenant_id' });
  if (subError) { console.error('❌ subscription:', subError.message); process.exit(1); }
  console.log(`   ✓ subscription: active`);

  // ===== 8. OWNER USER =====
  console.log('8️⃣  Creating owner user...');
  const ownerHash = await bcrypt.hash('123456', 12);
  const { error: ownerError } = await supabase
    .from('users')
    .upsert({
      email: 'owner@sefay.com',
      password_hash: ownerHash,
      name: 'Demo Owner',
      role: 'owner',
      tenant_id: tenant!.id,
      is_active: true,
    }, { onConflict: 'email' });
  if (ownerError) { console.error('❌ owner:', ownerError.message); process.exit(1); }
  console.log(`   ✓ owner: owner@sefay.com / 123456`);

  // ===== 9. BRANCH =====
  console.log('9️⃣  Creating branch...');
  const { error: branchError } = await supabase
    .from('branches')
    .upsert({
      tenant_id: tenant!.id,
      name: 'Main Branch',
      address: 'Riyadh, Saudi Arabia',
      is_active: true,
    }, { onConflict: 'tenant_id,name' });
  if (branchError) { console.error('❌ branch:', branchError.message); process.exit(1); }
  console.log(`   ✓ branch: Main Branch`);

  console.log('\n✅ Full setup complete!\n');
  console.log('📋 Accounts:');
  console.log('   SuperAdmin : admin@sefay.com  / 123456');
  console.log('   Owner      : owner@sefay.com  / 123456');
}

seed().catch(console.error);