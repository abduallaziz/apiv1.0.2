import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const permissions = [
  { name: 'invoice.create.own', resource: 'invoice', action: 'create', description: 'Create own invoices' },
  { name: 'invoice.view.own', resource: 'invoice', action: 'view', description: 'View own invoices' },
  { name: 'invoice.view.branch', resource: 'invoice', action: 'view', description: 'View branch invoices' },
  { name: 'invoice.view.all', resource: 'invoice', action: 'view', description: 'View all invoices' },
  { name: 'invoice.cancel.own', resource: 'invoice', action: 'cancel', description: 'Cancel own invoices' },
  { name: 'invoice.cancel.branch', resource: 'invoice', action: 'cancel', description: 'Cancel branch invoices' },
  { name: 'invoice.view', resource: 'invoice', action: 'view', description: 'View invoices (flat, matches InvoicesController guard)' },
  { name: 'invoice.create', resource: 'invoice', action: 'create', description: 'Create invoices (flat, matches InvoicesController guard)' },
  { name: 'invoice.cancel', resource: 'invoice', action: 'cancel', description: 'Cancel invoices (flat, matches InvoicesController guard)' },
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
  { name: 'items.view', resource: 'items', action: 'view', description: 'View items' },
  { name: 'items.manage', resource: 'items', action: 'manage', description: 'Manage items' },
  { name: 'branches.view', resource: 'branches', action: 'view', description: 'View branches' },
  { name: 'branches.manage', resource: 'branches', action: 'manage', description: 'Manage branches' },
  { name: 'customers.view', resource: 'customers', action: 'view', description: 'View customers' },
  { name: 'customers.manage', resource: 'customers', action: 'manage', description: 'Manage customers' },
  { name: 'expenses.view', resource: 'expenses', action: 'view', description: 'View expenses' },
  { name: 'expenses.manage', resource: 'expenses', action: 'manage', description: 'Manage expenses' },
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

const rolePerms: { role: string; permission_key: string; is_granted: boolean }[] = [];
const add = (role: string, keys: string[]) =>
  keys.forEach(k => rolePerms.push({ role, permission_key: k, is_granted: true }));

add('superadmin', ['analytics.view.all','audit.view.all','invoice.view.all','expense.view.all','expense.approve','expense.reject','shift.view.all','users.manage','branches.manage','branches.view','items.manage','items.view','customers.view','customers.manage','expenses.view','expenses.manage','reports.view.all','settings.manage','superadmin.queue.view','superadmin.queue.manage','superadmin.health.view','superadmin.backup.view','invoice.create.own','invoice.view.own','invoice.cancel.branch']);
add('owner', ['invoice.create.own','invoice.cancel.branch','invoice.view.all','invoice.view','invoice.create','invoice.cancel','expense.approve','expense.reject','expense.view.all','shift.open','shift.close','shift.view.all','users.manage','branches.manage','branches.view','items.manage','items.view','customers.view','customers.manage','expenses.view','expenses.manage','reports.view.all','reports.view.branch','settings.view','settings.manage']);
add('manager', ['invoice.create.own','invoice.view.branch','invoice.view','invoice.create','expense.view.branch','shift.open','shift.close','shift.view.branch','users.view','items.manage','items.view','customers.view','customers.manage','expenses.view','reports.view.branch','settings.view']);
add('cashier', ['invoice.create.own','invoice.view.own','invoice.view','invoice.create','expense.request','expenses.view','shift.open','shift.close','shift.view.own','items.view','customers.view','customers.manage']);
add('worker', ['invoice.view.own','invoice.view','shift.view.own','items.view']);

export { permissions, rolePerms };

export async function seedPermissions(): Promise<void> {
  console.log('Seeding permissions...');

  const { error: permError } = await supabase
    .from('permissions')
    .upsert(permissions, { onConflict: 'name' });

  if (permError) {
    throw new Error(`Error seeding permissions: ${permError.message}`);
  }
  console.log(`✓ ${permissions.length} permissions seeded`);

  const { error: rpError } = await supabase
    .from('role_permissions')
    .upsert(rolePerms, { onConflict: 'role,permission_key' });

  if (rpError) {
    throw new Error(`Error seeding role_permissions: ${rpError.message}`);
  }
  console.log(`✓ ${rolePerms.length} role_permissions seeded`);
  console.log('Done ✓');
}

if (require.main === module) {
  seedPermissions().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}