import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { permissions, rolePerms } from '../database/seeds/permissions.seed';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function seed() {
  console.log('🚀 Starting full setup seed...\n');

  // كلمات المرور من البيئة أو توليد عشوائي
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(12).toString('hex');
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? crypto.randomBytes(12).toString('hex');

  // ===== 1. PERMISSIONS =====
  console.log('1️⃣  Seeding permissions...');
  const { error: permError } = await supabase
    .from('permissions')
    .upsert(permissions, { onConflict: 'name' });
  if (permError) { console.error('❌ permissions:', permError.message); process.exit(1); }
  console.log(`   ✓ ${permissions.length} permissions`);

  // ===== 2. ROLE_PERMISSIONS =====
  console.log('2️⃣  Seeding role_permissions...');
  const { error: rpError } = await supabase
    .from('role_permissions')
    .upsert(rolePerms, { onConflict: 'role,permission_key' });
  if (rpError) { console.error('❌ role_permissions:', rpError.message); process.exit(1); }
  console.log(`   ✓ ${rolePerms.length} role_permissions`);

  // ===== 3. SUPERADMIN USER =====
  console.log('3️⃣  Creating superadmin user...');
  const superadminHash = await bcrypt.hash(adminPassword, 12);
  const { error: saError } = await supabase
    .from('users')
    .upsert({
      email: 'admin@sefay.com',
      password_hash: superadminHash,
      name: 'Super Admin',
      role: 'superadmin',
      tenant_id: null,
      is_active: true,
    }, { onConflict: 'email' });
  if (saError) { console.error('❌ superadmin:', saError.message); process.exit(1); }
  console.log(`   ✓ superadmin: admin@sefay.com`);

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
  const ownerHash = await bcrypt.hash(ownerPassword, 12);
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
  console.log(`   ✓ owner: owner@sefay.com`);

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
  console.log(`   SuperAdmin : admin@sefay.com  / ${adminPassword}`);
  console.log(`   Owner      : owner@sefay.com  / ${ownerPassword}`);
  console.log('\n⚠️  Save these passwords — they will not be shown again.');
}

seed().catch(console.error);