import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Branch Domain Batch 1, B4 (Owner-approved) — pre-change audit found
// invoice.view.own/branch/all and expense.view.branch/all are seeded and
// actively granted (11 role_permissions rows + 12 real tenant_role_
// permissions overrides, live-queried, not assumed) but NEVER checked by
// any controller — invoices.controller.ts and expenses.controller.ts gate
// on the flat invoice.view / expenses.view instead. Real branch scope is
// now enforced by B1-B3's server-derived effectiveBranchId
// (BranchAuthorizationService.resolveBranchScope), not by which of these
// tiers a role holds.
//
// Deliberately NOT deleted: permission_key has ON DELETE CASCADE onto
// role_permissions AND tenant_role_permissions (001_initial_schema.sql,
// 064_create_tenant_role_permissions.sql) — removing these rows would
// silently destroy 23 live grant/override rows across real tenants for no
// safety benefit, since nothing reads them today anyway. Retained
// as-is, documented as deprecated/non-authoritative for scope. A future,
// separately-approved migration can retire them once every consumer of
// the permission-admin UI (if any surfaces these names to tenant owners)
// has been checked.
const permissions = [
  {
    name: 'invoice.create.own',
    resource: 'invoice',
    action: 'create',
    description: 'Create own invoices',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — never checked by any
    // controller; invoices.controller.ts gates on the flat 'invoice.view'
    // instead. Real scope enforcement is BranchAuthorizationService's
    // server-derived effectiveBranchId, not this tier. Retained (not
    // deleted) only because live tenant_role_permissions overrides
    // reference it — see the module-level comment above.
    name: 'invoice.view.own',
    resource: 'invoice',
    action: 'view',
    description: 'View own invoices',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — see invoice.view.own above.
    name: 'invoice.view.branch',
    resource: 'invoice',
    action: 'view',
    description: 'View branch invoices',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — see invoice.view.own above.
    name: 'invoice.view.all',
    resource: 'invoice',
    action: 'view',
    description: 'View all invoices',
  },
  {
    name: 'invoice.cancel.own',
    resource: 'invoice',
    action: 'cancel',
    description: 'Cancel own invoices',
  },
  {
    name: 'invoice.cancel.branch',
    resource: 'invoice',
    action: 'cancel',
    description: 'Cancel branch invoices',
  },
  {
    name: 'invoice.view',
    resource: 'invoice',
    action: 'view',
    description: 'View invoices (flat, matches InvoicesController guard)',
  },
  {
    name: 'invoice.create',
    resource: 'invoice',
    action: 'create',
    description: 'Create invoices (flat, matches InvoicesController guard)',
  },
  {
    name: 'invoice.cancel',
    resource: 'invoice',
    action: 'cancel',
    description: 'Cancel invoices (flat, matches InvoicesController guard)',
  },
  {
    name: 'invoice.price_override',
    resource: 'invoice',
    action: 'price_override',
    description: 'Override an item unit price during a sale (D01)',
  },
  {
    name: 'expense.request',
    resource: 'expense',
    action: 'request',
    description: 'Submit expense requests',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — never checked by any
    // controller; expenses.controller.ts gates on the flat 'expenses.view'
    // instead. See the invoice.view.own comment above for the full
    // rationale (same class of finding, same retain-not-delete decision).
    name: 'expense.view.branch',
    resource: 'expense',
    action: 'view',
    description: 'View branch expenses',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — see expense.view.branch above.
    name: 'expense.view.all',
    resource: 'expense',
    action: 'view',
    description: 'View all expenses',
  },
  {
    name: 'expense.approve',
    resource: 'expense',
    action: 'approve',
    description: 'Approve expenses',
  },
  {
    name: 'expense.reject',
    resource: 'expense',
    action: 'reject',
    description: 'Reject expenses',
  },
  {
    name: 'shift.open',
    resource: 'shift',
    action: 'open',
    description: 'Open a shift',
  },
  {
    name: 'shift.close',
    resource: 'shift',
    action: 'close',
    description: 'Close own shift',
  },
  {
    name: 'shift.view.own',
    resource: 'shift',
    action: 'view',
    description: 'View own shift',
  },
  {
    name: 'shift.view.branch',
    resource: 'shift',
    action: 'view',
    description: 'View branch shifts',
  },
  {
    // DEPRECATED (Branch Domain Batch 1, B4) — never checked by any
    // controller; shift.view.own and shift.view.branch immediately above
    // are the two real, enforced tiers (shifts.controller.ts). Retained
    // (not deleted) only because live tenant_role_permissions overrides
    // reference it — see the invoice.view.own comment above.
    name: 'shift.view.all',
    resource: 'shift',
    action: 'view',
    description: 'View all shifts',
  },
  {
    name: 'users.view',
    resource: 'users',
    action: 'view',
    description: 'View users',
  },
  {
    name: 'users.manage',
    resource: 'users',
    action: 'manage',
    description: 'Manage users',
  },
  {
    name: 'items.view',
    resource: 'items',
    action: 'view',
    description: 'View items',
  },
  {
    name: 'items.manage',
    resource: 'items',
    action: 'manage',
    description: 'Manage items',
  },
  {
    name: 'branches.view',
    resource: 'branches',
    action: 'view',
    description: 'View branches',
  },
  {
    name: 'branches.manage',
    resource: 'branches',
    action: 'manage',
    description: 'Manage branches',
  },
  {
    name: 'customers.view',
    resource: 'customers',
    action: 'view',
    description: 'View customers',
  },
  {
    name: 'customers.manage',
    resource: 'customers',
    action: 'manage',
    description: 'Manage customers',
  },
  // Batch 1 Remediation 1 (Owner-approved) — customers.view/.manage kept
  // above unchanged as active compatibility aliases (not hard-cut) so no
  // existing tenant_role_permissions/user_permissions_override row
  // referencing them silently loses effect. The 4 approved capability keys:
  // customers.view already exists above and is reused as-is (list/read);
  // these 3 are new, splitting what customers.manage used to cover as one
  // undifferentiated grant.
  {
    name: 'customers.create',
    resource: 'customers',
    action: 'create',
    description: 'Create customers',
  },
  {
    name: 'customers.update',
    resource: 'customers',
    action: 'update',
    description: 'Update customers',
  },
  {
    name: 'customers.archive',
    resource: 'customers',
    action: 'archive',
    description: 'Archive/delete customers',
  },
  {
    name: 'expenses.view',
    resource: 'expenses',
    action: 'view',
    description: 'View expenses',
  },
  {
    name: 'expenses.manage',
    resource: 'expenses',
    action: 'manage',
    description: 'Manage expenses',
  },
  // NEW EXPENSES domain (expenses_v2 and related tables) — reuses the
  // existing expenses.view/expenses.manage keys above unchanged (locked
  // Owner decision: exactly 4 keys, no separate Department permissions),
  // and adds the 2 keys that key set requires beyond what Legacy Expenses
  // already had.
  {
    name: 'expenses.create',
    resource: 'expenses',
    action: 'create',
    description: 'Create expenses',
  },
  {
    name: 'expenses.configure',
    resource: 'expenses',
    action: 'configure',
    description:
      'Manage expense configuration: Departments, Categories, and Quick Expense Definitions',
  },
  {
    name: 'reports.view.branch',
    resource: 'reports',
    action: 'view',
    description: 'View branch reports',
  },
  {
    name: 'reports.view.all',
    resource: 'reports',
    action: 'view',
    description: 'View all reports',
  },
  {
    name: 'settings.view',
    resource: 'settings',
    action: 'view',
    description: 'View settings',
  },
  {
    name: 'settings.manage',
    resource: 'settings',
    action: 'manage',
    description: 'Manage settings',
  },
  {
    name: 'analytics.view.all',
    resource: 'analytics',
    action: 'view',
    description: 'View platform analytics',
  },
  {
    name: 'audit.view.all',
    resource: 'audit',
    action: 'view',
    description: 'View audit logs',
  },
  {
    name: 'superadmin.queue.view',
    resource: 'superadmin',
    action: 'queue.view',
    description: 'View queues',
  },
  {
    name: 'superadmin.queue.manage',
    resource: 'superadmin',
    action: 'queue.manage',
    description: 'Manage queues',
  },
  {
    name: 'superadmin.health.view',
    resource: 'superadmin',
    action: 'health.view',
    description: 'View health',
  },
  {
    name: 'superadmin.backup.view',
    resource: 'superadmin',
    action: 'backup.view',
    description: 'View backup',
  },

  // Inventory
  {
    name: 'inventory.view',
    resource: 'inventory',
    action: 'view',
    description: 'View warehouses, stock levels and movements',
  },
  {
    name: 'inventory.manage',
    resource: 'inventory',
    action: 'manage',
    description: 'Manage warehouses, locations, reorder points',
  },
  {
    name: 'inventory.adjust',
    resource: 'inventory',
    action: 'adjust',
    description: 'Create stock adjustments',
  },
  {
    name: 'inventory.adjust.approve',
    resource: 'inventory',
    action: 'adjust.approve',
    description: 'Approve stock adjustments above threshold',
  },
  {
    name: 'inventory.transfer',
    resource: 'inventory',
    action: 'transfer',
    description: 'Create and process warehouse transfers',
  },
  {
    name: 'inventory.transfer.approve',
    resource: 'inventory',
    action: 'transfer.approve',
    description: 'Approve draft transfers before dispatch',
  },
  {
    name: 'inventory.count',
    resource: 'inventory',
    action: 'count',
    description: 'Perform and finalize stock counts',
  },
  {
    name: 'inventory.reserve',
    resource: 'inventory',
    action: 'reserve',
    description: 'Create and release stock reservations',
  },
  {
    name: 'inventory.fulfill',
    resource: 'inventory',
    action: 'fulfill',
    description: 'Pick, pack and ship warehouse shipments',
  },

  // Manufacturing
  {
    name: 'manufacturing.view',
    resource: 'manufacturing',
    action: 'view',
    description: 'View BOMs, work centers and production orders',
  },
  {
    name: 'manufacturing.manage',
    resource: 'manufacturing',
    action: 'manage',
    description: 'Create and edit BOMs and work centers',
  },
  {
    name: 'manufacturing.plan',
    resource: 'manufacturing',
    action: 'plan',
    description: 'Create production orders',
  },
  {
    name: 'manufacturing.execute',
    resource: 'manufacturing',
    action: 'execute',
    description: 'Start, complete and cancel production orders',
  },

  // Quality
  {
    name: 'quality.view',
    resource: 'quality',
    action: 'view',
    description: 'View quality inspections, holds and non-conformances',
  },
  {
    name: 'quality.manage',
    resource: 'quality',
    action: 'manage',
    description:
      'Configure quality templates/plans/rules, create non-conformances, assign corrective actions',
  },
  {
    name: 'quality.execute',
    resource: 'quality',
    action: 'execute',
    description:
      'Perform inspections, create quality holds, work corrective actions',
  },
  {
    name: 'quality.approve',
    resource: 'quality',
    action: 'approve',
    description:
      'Release/reject quality holds, verify and close corrective actions, decide deviations, close non-conformances',
  },

  // Warehouse (WMS) — Picking/Packing/Shipping execution reuses the
  // existing inventory.view/inventory.fulfill (per approved design, no
  // duplicate warehouse.view/warehouse.execute keys). These two are only
  // for the genuinely new administration surface: Putaway Rules, Location
  // configuration (purpose/capacity/restrictions), Replenishment Rules,
  // and Warehouse Task assignment/approval.
  {
    name: 'warehouse.manage',
    resource: 'warehouse',
    action: 'manage',
    description:
      'Configure putaway rules, replenishment rules, location purpose/capacity/restrictions; create/assign warehouse tasks',
  },
  {
    name: 'warehouse.approve',
    resource: 'warehouse',
    action: 'approve',
    description:
      'Confirm/complete warehouse tasks (putaway/replenishment placement)',
  },

  // Scanner Platform (Universal Device Platform, #21) — device
  // registration/pairing/health is administrative; scanning itself reuses
  // existing inventory.* / warehouse.* / quality.* permissions on the
  // Action Framework's target service, per the approved design (no
  // separate "scan.execute" key — the action is authorized by whatever
  // it actually does, not by the fact a scanner triggered it).
  {
    name: 'devices.view',
    resource: 'devices',
    action: 'view',
    description: 'View registered scanner devices, sessions and events',
  },
  {
    name: 'devices.manage',
    resource: 'devices',
    action: 'manage',
    description:
      'Register/edit/disable scanner devices, assign devices to users/warehouses',
  },

  // Ownership
  {
    name: 'ownership.view',
    resource: 'ownership',
    action: 'view',
    description:
      'View inventory ownership layers (consignment/customer-owned stock)',
  },
  {
    name: 'ownership.manage',
    resource: 'ownership',
    action: 'manage',
    description: 'Create ownership layers, transfer/release ownership',
  },

  // Purchasing
  {
    name: 'purchasing.view',
    resource: 'purchasing',
    action: 'view',
    description: 'View suppliers, purchase orders and goods receipts',
  },
  {
    name: 'purchasing.manage',
    resource: 'purchasing',
    action: 'manage',
    description: 'Create/edit suppliers and purchase orders',
  },
  {
    name: 'purchasing.approve',
    resource: 'purchasing',
    action: 'approve',
    description:
      '(legacy, superseded by purchasing.po.approve) Approve purchase orders',
  },
  {
    name: 'purchasing.po.approve',
    resource: 'purchasing',
    action: 'po.approve',
    description: 'Approve purchase orders',
  },
  {
    name: 'purchasing.po.reject',
    resource: 'purchasing',
    action: 'po.reject',
    description: 'Reject purchase orders',
  },
  {
    name: 'purchasing.pr.approve',
    resource: 'purchasing',
    action: 'pr.approve',
    description: 'Approve purchase requests',
  },
  {
    name: 'purchasing.pr.reject',
    resource: 'purchasing',
    action: 'pr.reject',
    description: 'Reject purchase requests',
  },
  {
    name: 'purchasing.rfq.approve',
    resource: 'purchasing',
    action: 'rfq.approve',
    description: 'Approve RFQs',
  },
  {
    name: 'purchasing.rfq.reject',
    resource: 'purchasing',
    action: 'rfq.reject',
    description: 'Reject RFQs',
  },
  {
    name: 'purchasing.agreement.approve',
    resource: 'purchasing',
    action: 'agreement.approve',
    description: 'Approve purchasing agreements',
  },
  {
    name: 'purchasing.agreement.reject',
    resource: 'purchasing',
    action: 'agreement.reject',
    description: 'Reject purchasing agreements',
  },
  {
    name: 'purchasing.amendment.approve',
    resource: 'purchasing',
    action: 'amendment.approve',
    description: 'Approve purchasing agreement amendments',
  },
  {
    name: 'purchasing.amendment.reject',
    resource: 'purchasing',
    action: 'amendment.reject',
    description: 'Reject purchasing agreement amendments',
  },
  {
    name: 'purchasing.release.approve',
    resource: 'purchasing',
    action: 'release.approve',
    description: 'Approve purchasing agreement releases',
  },
  {
    name: 'purchasing.release.reject',
    resource: 'purchasing',
    action: 'release.reject',
    description: 'Reject purchasing agreement releases',
  },
  {
    name: 'purchasing.receive',
    resource: 'purchasing',
    action: 'receive',
    description: 'Post goods receipts',
  },

  // HR
  {
    name: 'attendance.checkin',
    resource: 'attendance',
    action: 'checkin',
    description: 'Check in/out and view own attendance history',
  },
  {
    name: 'attendance.view.all',
    resource: 'attendance',
    action: 'view',
    description: 'View all employees attendance',
  },
  {
    name: 'hr.manage',
    resource: 'hr',
    action: 'manage',
    description: 'Manage work schedules and commission rates',
  },

  // Tables & dine-in (restaurants/cafes)
  {
    name: 'tables.manage',
    resource: 'tables',
    action: 'manage',
    description: 'Manage tables, dine-in orders, reservations and waitlist',
  },
  {
    name: 'kitchen.manage',
    resource: 'kitchen',
    action: 'manage',
    description: 'View and update kitchen order item status (KDS)',
  },

  // Coupons
  {
    name: 'coupons.manage',
    resource: 'coupons',
    action: 'manage',
    description: 'Create and manage discount coupons',
  },

  // Order note presets
  {
    name: 'note_presets.manage',
    resource: 'note_presets',
    action: 'manage',
    description: 'Create and manage preset order notes',
  },

  // Accounting Backend Phase 1 — read surface for the General Ledger
  // foundation (journal entries, sales posting, COGS reconciliation,
  // fiscal periods, chart of accounts) plus the one write action
  // (branch accounting assignment) that unblocks Sales Posting for
  // tenants/branches missing an Accounting Owner.
  {
    name: 'accounting.view',
    resource: 'accounting',
    action: 'view',
    description: 'View Accounting Command Center',
  },
  {
    name: 'accounting.journal.view',
    resource: 'accounting',
    action: 'view',
    description:
      'View Journal Entries, Sales Posting status, and COGS reconciliation',
  },
  {
    name: 'accounting.ledger.view',
    resource: 'accounting',
    action: 'view',
    description: 'View the Chart of Accounts',
  },
  {
    name: 'accounting.reconciliation.view',
    resource: 'accounting',
    action: 'view',
    description: 'View COGS reconciliation exceptions',
  },
  {
    name: 'accounting.period.manage',
    resource: 'accounting',
    action: 'manage',
    description: 'View Fiscal Period status',
  },
  {
    name: 'accounting.configuration.manage',
    resource: 'accounting',
    action: 'manage',
    description:
      'View and assign Accounting Owners / Branch Accounting Assignments',
  },
  {
    name: 'price_override.audit.view',
    resource: 'price_override',
    action: 'view',
    description: 'View the D01 Price Override Audit trail',
  },
];

const rolePerms: {
  role: string;
  permission_key: string;
  is_granted: boolean;
}[] = [];
const add = (role: string, keys: string[]) =>
  keys.forEach((k) =>
    rolePerms.push({ role, permission_key: k, is_granted: true }),
  );

// Branch Domain Batch 1, B4 (Owner-approved) — every invoice.view.*,
// expense.view.branch/all, and shift.view.all grant below is deprecated
// (see the definitions above) but deliberately kept exactly as-is: these
// role_permissions rows are real, live-queried grants (11 rows) plus 12
// real tenant_role_permissions overrides reference the same keys — this
// batch only stops those keys from being misleading in the seed's own
// comments, it does not touch any grant data.
add('superadmin', [
  'analytics.view.all',
  'audit.view.all',
  'invoice.view.all',
  'expense.view.all',
  'expense.approve',
  'expense.reject',
  'shift.view.all',
  'users.manage',
  'branches.manage',
  'branches.view',
  'items.manage',
  'items.view',
  'customers.view',
  'customers.manage',
  'customers.create',
  'customers.update',
  'customers.archive',
  'expenses.view',
  'expenses.manage',
  'expenses.create',
  'expenses.configure',
  'reports.view.all',
  'settings.manage',
  'superadmin.queue.view',
  'superadmin.queue.manage',
  'superadmin.health.view',
  'superadmin.backup.view',
  'invoice.create.own',
  'invoice.view.own',
  'invoice.cancel.branch',
  'inventory.view',
  'inventory.manage',
  'inventory.adjust',
  'inventory.adjust.approve',
  'inventory.transfer',
  'inventory.transfer.approve',
  'inventory.count',
  'inventory.reserve',
  'inventory.fulfill',
  'manufacturing.view',
  'manufacturing.manage',
  'manufacturing.plan',
  'manufacturing.execute',
  'quality.view',
  'quality.manage',
  'quality.execute',
  'quality.approve',
  'warehouse.manage',
  'warehouse.approve',
  'devices.view',
  'devices.manage',
  'ownership.view',
  'ownership.manage',
  'purchasing.view',
  'purchasing.manage',
  'purchasing.po.approve',
  'purchasing.po.reject',
  'purchasing.pr.approve',
  'purchasing.pr.reject',
  'purchasing.rfq.approve',
  'purchasing.rfq.reject',
  'purchasing.agreement.approve',
  'purchasing.agreement.reject',
  'purchasing.amendment.approve',
  'purchasing.amendment.reject',
  'purchasing.release.approve',
  'purchasing.release.reject',
  'purchasing.receive',
  'attendance.checkin',
  'attendance.view.all',
  'hr.manage',
  'tables.manage',
  'kitchen.manage',
  'coupons.manage',
  'note_presets.manage',
]);
add('owner', [
  'invoice.create.own',
  'invoice.cancel.branch',
  'invoice.view.all',
  'invoice.view',
  'invoice.create',
  'invoice.cancel',
  'expense.approve',
  'expense.reject',
  'expense.view.all',
  'shift.open',
  'shift.close',
  'shift.view.own',
  'shift.view.all',
  'users.manage',
  'branches.manage',
  'branches.view',
  'items.manage',
  'items.view',
  'customers.view',
  'customers.manage',
  'customers.create',
  'customers.update',
  'customers.archive',
  'expenses.view',
  'expenses.manage',
  'expenses.create',
  'expenses.configure',
  'reports.view.all',
  'reports.view.branch',
  'settings.view',
  'settings.manage',
  'inventory.view',
  'inventory.manage',
  'inventory.adjust',
  'inventory.adjust.approve',
  'inventory.transfer',
  'inventory.transfer.approve',
  'inventory.count',
  'inventory.reserve',
  'inventory.fulfill',
  'manufacturing.view',
  'manufacturing.manage',
  'manufacturing.plan',
  'manufacturing.execute',
  'quality.view',
  'quality.manage',
  'quality.execute',
  'quality.approve',
  'warehouse.manage',
  'warehouse.approve',
  'devices.view',
  'devices.manage',
  'ownership.view',
  'ownership.manage',
  'purchasing.view',
  'purchasing.manage',
  'purchasing.po.approve',
  'purchasing.po.reject',
  'purchasing.pr.approve',
  'purchasing.pr.reject',
  'purchasing.rfq.approve',
  'purchasing.rfq.reject',
  'purchasing.agreement.approve',
  'purchasing.agreement.reject',
  'purchasing.amendment.approve',
  'purchasing.amendment.reject',
  'purchasing.release.approve',
  'purchasing.release.reject',
  'purchasing.receive',
  'attendance.checkin',
  'attendance.view.all',
  'hr.manage',
  'tables.manage',
  'kitchen.manage',
  'coupons.manage',
  'note_presets.manage',
  'accounting.view',
  'accounting.journal.view',
  'accounting.ledger.view',
  'accounting.reconciliation.view',
  'accounting.period.manage',
  'accounting.configuration.manage',
  'price_override.audit.view',
]);
add('manager', [
  'invoice.create.own',
  'invoice.view.branch',
  'invoice.view',
  'invoice.create',
  'expense.view.branch',
  'shift.open',
  'shift.close',
  'shift.view.own',
  'shift.view.branch',
  'users.view',
  'items.manage',
  'items.view',
  'customers.view',
  'customers.manage',
  'customers.create',
  'customers.update',
  'customers.archive',
  'expenses.view',
  'expenses.create',
  'reports.view.branch',
  'settings.view',
  'inventory.view',
  'inventory.manage',
  'inventory.adjust',
  'inventory.adjust.approve',
  'inventory.transfer',
  'inventory.transfer.approve',
  'inventory.count',
  'inventory.reserve',
  'inventory.fulfill',
  'manufacturing.view',
  'manufacturing.manage',
  'manufacturing.plan',
  'manufacturing.execute',
  'quality.view',
  'quality.manage',
  'quality.execute',
  'quality.approve',
  'warehouse.manage',
  'warehouse.approve',
  'devices.view',
  'devices.manage',
  'ownership.view',
  'ownership.manage',
  'purchasing.view',
  'purchasing.manage',
  'purchasing.po.approve',
  'purchasing.po.reject',
  'purchasing.pr.approve',
  'purchasing.pr.reject',
  'purchasing.rfq.approve',
  'purchasing.rfq.reject',
  'purchasing.agreement.approve',
  'purchasing.agreement.reject',
  'purchasing.amendment.approve',
  'purchasing.amendment.reject',
  'purchasing.release.approve',
  'purchasing.release.reject',
  'purchasing.receive',
  'attendance.checkin',
  'attendance.view.all',
  'hr.manage',
  'tables.manage',
  'kitchen.manage',
  'coupons.manage',
  'note_presets.manage',
  'accounting.view',
  'accounting.journal.view',
  'accounting.ledger.view',
  'accounting.reconciliation.view',
  'accounting.period.manage',
  'price_override.audit.view',
]);
add('inventory_clerk', [
  'items.view',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.count',
  'inventory.reserve',
  'inventory.fulfill',
  'manufacturing.view',
  'manufacturing.execute',
  'quality.view',
  'ownership.view',
  'purchasing.view',
  'purchasing.manage',
  'purchasing.receive',
  'attendance.checkin',
]);
add('cashier', [
  'invoice.create.own',
  'invoice.view.own',
  'invoice.view',
  'invoice.create',
  'expense.request',
  'expenses.view',
  'expenses.create',
  'shift.open',
  'shift.close',
  'shift.view.own',
  'items.view',
  'customers.view',
  'customers.manage',
  'customers.create',
  'customers.update',
  'customers.archive',
  'inventory.view',
  'inventory.reserve',
  'attendance.checkin',
  'tables.manage',
  'kitchen.manage',
]);
add('worker', [
  'invoice.view.own',
  'invoice.view',
  'shift.view.own',
  'items.view',
  'inventory.view',
  'attendance.checkin',
  'kitchen.manage',
]);

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
