import { ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ReportsService } from './reports.service';
import { BranchAuthorizationService } from '../../core/security/branch-authorization.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Mock-only: no DB. Records every .eq() per table and returns canned rows.
function fake(tables: Record<string, unknown[]> = {}) {
  const eqs: { table: string; col: string; val: unknown }[] = [];
  const mk = (table: string) => {
    const c: any = {};
    for (const m of [
      'select',
      'gte',
      'lte',
      'not',
      'in',
      'order',
      'limit',
      'range',
      'is',
    ])
      c[m] = jest.fn(() => c);
    c.eq = jest.fn((col: string, val: unknown) => {
      eqs.push({ table, col, val });
      return c;
    });
    c.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
    );
    c.single = jest.fn(() =>
      Promise.resolve({ data: { tax_rate: 0.15 }, error: null }),
    );
    c.then = (resolve: (v: unknown) => void) =>
      resolve({ data: tables[table] ?? [], error: null });
    return c;
  };
  return {
    supabase: {
      from: jest.fn((t: string) => mk(t)),
    } as unknown as SupabaseClient,
    eqs,
  };
}

const build = (tables?: Record<string, unknown[]>) => {
  const { supabase, eqs } = fake(tables);
  const auth = new BranchAuthorizationService({
    validate: () => Promise.resolve(),
  } as unknown as BranchValidatorService);
  return { service: new ReportsService(supabase, auth), eqs };
};
const central = {
  sub: 'u',
  tenant_id: 't',
  branch_id: null,
} as unknown as JwtPayload;
const restricted = {
  sub: 'u',
  tenant_id: 't',
  branch_id: 'bA',
} as unknown as JwtPayload;

describe('ReportsService - branch isolation', () => {
  it('isolated: revenue is scoped to the context branch, ignoring other query branch', async () => {
    const { service, eqs } = build();
    const t = new TenantContext('t', 'bA', true);
    await service.getRevenueReport(t, central, {});
    expect(
      eqs.some(
        (e) => e.table === 'orders' && e.col === 'branch_id' && e.val === 'bA',
      ),
    ).toBe(true);
    await expect(
      service.getRevenueReport(t, central, { branch_id: 'bB' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('not isolated: tenant-wide behaviour unchanged (no branch filter)', async () => {
    const { service, eqs } = build();
    await service.getRevenueReport(new TenantContext('t', null), central, {});
    expect(eqs.some((e) => e.col === 'branch_id')).toBe(false);
  });

  it('isolated: employees and customers reports filter by the context branch', async () => {
    const { service, eqs } = build();
    const t = new TenantContext('t', 'bA', true);
    await service.getEmployeesReport(t, {} as any);
    await service.getCustomersReport(t, {} as any);
    expect(
      eqs.filter(
        (e) => e.table === 'orders' && e.col === 'branch_id' && e.val === 'bA',
      ),
    ).toHaveLength(2);
  });

  it('isolated: payroll restricts the employee set to the branch', async () => {
    const { service, eqs } = build();
    await service.getPayrollReport(
      new TenantContext('t', 'bA', true),
      '2026-11',
    );
    expect(
      eqs.some(
        (e) => e.table === 'users' && e.col === 'branch_id' && e.val === 'bA',
      ),
    ).toBe(true);
  });

  it('branches-summary: 403 for a branch-restricted user', async () => {
    const { service } = build();
    await expect(
      service.getBranchesSummary(
        new TenantContext('t', 'bA', true),
        restricted,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('branches-summary: aggregates per branch for a central user', async () => {
    const now = new Date().toISOString();
    const today = now.substring(0, 10);
    const { service } = build({
      branches: [
        { id: 'bA', name: 'Main', is_main: true },
        { id: 'bB', name: 'Two', is_main: false },
      ],
      orders: [
        { total: 100, branch_id: 'bA', created_at: now },
        { total: 50, branch_id: 'bB', created_at: now },
      ],
      expenses_v2: [{ amount: 30, branch_id: 'bA', expense_date: today }],
      users: [{ branch_id: 'bA' }, { branch_id: 'bA' }, { branch_id: 'bB' }],
      shifts: [{ branch_id: 'bB' }],
    });
    const r = await service.getBranchesSummary(
      new TenantContext('t', 'bA', true),
      central,
    );
    const a = r.branches.find((b) => b.branch_id === 'bA');
    const b = r.branches.find((x) => x.branch_id === 'bB');
    expect(a).toMatchObject({
      sales_month: 100,
      invoices_today: 1,
      expenses_month: 30,
      net_month: 70,
      employee_count: 2,
      has_open_shift: false,
      is_main: true,
    });
    expect(b).toMatchObject({
      sales_month: 50,
      employee_count: 1,
      has_open_shift: true,
    });
  });
});
