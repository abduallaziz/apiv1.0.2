import { SupabaseClient } from '@supabase/supabase-js';
import { ReportsService } from './reports.service';
import { BranchAuthorizationService } from '../../core/security/branch-authorization.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Reports must reconcile with the Orders list, which excludes soft-deleted
// rows (deleted_at IS NOT NULL). Every query on `orders` has to do the same.
function fake(rows: unknown[]) {
  const calls: { table: string; is: [string, unknown][] }[] = [];
  const mk = (table: string) => {
    const rec = { table, is: [] as [string, unknown][] };
    calls.push(rec);
    const c: any = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'in', 'order', 'limit'])
      c[m] = jest.fn(() => c);
    c.is = jest.fn((col: string, v: unknown) => {
      rec.is.push([col, v]);
      return c;
    });
    c.single = jest.fn(() =>
      Promise.resolve({ data: { tax_rate: 0.15 }, error: null }),
    );
    c.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
    );
    c.then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === 'orders' ? rows : [], error: null });
    return c;
  };
  return {
    supabase: { from: jest.fn((t: string) => mk(t)) } as unknown as SupabaseClient,
    calls,
  };
}

const user = {
  sub: 'u',
  role: 'owner',
  tenant_id: 't',
  branch_id: null,
} as unknown as JwtPayload;

function build(rows: unknown[]) {
  const { supabase, calls } = fake(rows);
  const auth = new BranchAuthorizationService({
    validate: () => Promise.resolve(),
  } as unknown as BranchValidatorService);
  return { service: new ReportsService(supabase, auth), calls };
}

describe('ReportsService - soft-deleted orders are excluded', () => {
  it('revenue + tax + payments query orders with deleted_at IS NULL', async () => {
    const { service, calls } = build([
      {
        id: 'o1',
        total: 10,
        subtotal: 10,
        discount: 0,
        tax: 0,
        payment_method: 'cash',
        created_at: '2026-07-17T10:00:00Z',
      },
    ]);
    const t = new TenantContext('t', null);
    await service.getRevenueReport(t, user, {});
    await service.getTaxReport(t, user, {});
    const orderQueries = calls.filter((c) => c.table === 'orders');
    expect(orderQueries.length).toBeGreaterThanOrEqual(3);
    for (const q of orderQueries) {
      expect(q.is).toContainEqual(['deleted_at', null]);
    }
  });
});
