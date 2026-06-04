import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const permissions = [
  // Invoices
  { key: 'invoice.create.own', resource: 'invoice', action: 'create', scope: 'own', description: 'Create own invoices' },
  { key: 'invoice.view.own', resource: 'invoice', action: 'view', scope: 'own', description: 'View own invoices' },
  { key: 'invoice.view.branch', resource: 'invoice', action: 'view', scope: 'branch', description: 'View branch invoices' },
  { key: 'invoice.view.all', resource: 'invoice', action: 'view', scope: 'all', description: 'View all invoices' },
  { key: 'invoice.cancel.own', resource: 'invoice', action: 'cancel', scope: 'own', description: 'Cancel own invoices' },
  { key: 'invoice.cancel.branch', resource: 'invoice', action: 'cancel', scope: 'branch', description: 'Cancel branch invoices' },

  // Expenses
  { key: 'expense.request', resource: 'expense', action: 'request', scope: 'own', description: 'Submit expense requests' },
  { key: 'expense.view.branch', resource: 'expense', action: 'view', scope: 'branch', description: 'View branch expenses' },
  { key: 'expense.view.all', resource: 'expense', action: 'view', scope: 'all', description: 'View all expenses' },
  { key: 'expense.approve', resource: 'expense', action: 'approve', scope: 'all', description: 'Approve expenses' },
  { key: 'expense.reject', resource: 'expense', action: 'reject', scope: 'all', description: 'Reject expenses' },

  // Shifts
  { key: 'shift.open', resource: 'shift', action: 'open', scope: 'own', description: 'Open a shift' },
  { key: 'shift.close', resource: 'shift', action: 'close', scope: 'own', description: 'Close own shift' },
  { key: 'shift.view.own', resource: 'shift', action: 'view', scope: 'own', description: 'View own shift' },
  { key: 'shift.view.branch', resource: 'shift', action: 'view', scope: 'branch', description: 'View branch shifts' },
  { key: 'shift.view.all', resource: 'shift', action: 'view', scope: 'all', description: 'View all shifts' },

  // Users
  { key: 'users.view', resource: 'users', action: 'view', scope: 'branch', description: 'View users' },
  { key: 'users.manage', resource: 'users', action: 'manage', scope: 'all', description: 'Manage users' },

  // Items
  { key: 'items.manage', resource: 'items', action: 'manage', scope: 'all', description: 'Manage items' },

  // Branches
  { key: 'branches.manage', resource: 'branches', action: 'manage', scope: 'all', description: 'Manage branches' },

  // Reports
  { key: 'reports.view.branch', resource: 'reports', action: 'view', scope: 'branch', description: 'View branch reports' },
  { key: 'reports.view.all', resource: 'reports', action: 'view', scope: 'all', description: 'View all reports' },

  // Settings
  { key: 'settings.view', resource: 'settings', action: 'view', scope: 'own', description: 'View tenant settings' },
  { key: 'settings.manage', resource: 'settings', action: 'manage', scope: 'all', description: 'Manage settings' },
];

const rolePermissions: { role: string; permission_key: string; is_granted: boolean }[] = [];

const ownerPermissions = [
  'invoice.create.own', 'invoice.cancel.branch', 'invoice.view.all',
  'expense.approve', 'expense.reject', 'expense.view.all',
  'shift.open', 'shift.close', 'shift.view.all',
  'users.manage', 'branches.manage', 'items.manage',
  'reports.view.all', 'settings.view', 'settings.manage',
];

const managerPermissions = [
  'invoice.create.own', 'invoice.view.branch',
  'expense.view.branch',
  'shift.open', 'shift.close', 'shift.view.branch',
  'users.view', 'items.manage',
  'reports.view.branch', 'settings.view',
];

const cashierPermissions = [
  'invoice.create.own', 'invoice.view.own',
  'expense.request',
  'shift.open', 'shift.close', 'shift.view.own',
];

const workerPermissions = [
  'invoice.view.own',
  'shift.view.own',
];

function addRolePermissions(role: string, keys: string[]) {
  for (const key of keys) {
    rolePermissions.push({ role, permission_key: key, is_granted: true });
  }
}

addRolePermissions('owner', ownerPermissions);
addRolePermissions('manager', managerPermissions);
addRolePermissions('cashier', cashierPermissions);
addRolePermissions('worker', workerPermissions);

async function seed() {
  console.log('Seeding permissions...');

  const { error: permError } = await supabase
    .from('permissions')
    .upsert(permissions, { onConflict: 'key' });

  if (permError) {
    console.error('Error seeding permissions:', permError.message);
    process.exit(1);
  }

  console.log(`✓ ${permissions.length} permissions seeded`);

  const { error: rpError } = await supabase
    .from('role_permissions')
    .upsert(rolePermissions, { onConflict: 'role,permission_key' });

  if (rpError) {
    console.error('Error seeding role_permissions:', rpError.message);
    process.exit(1);
  }

  console.log(`✓ ${rolePermissions.length} role_permissions seeded`);
  console.log('Done ✓');
}

seed();