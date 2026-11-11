import { HttpException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingCycle, SubscriptionStatus } from './billing.types';

// In-memory fake of the few supabase calls activateSubscription makes.
function fakeSupabase(existing: Record<string, unknown> | null) {
  const writes: Array<{ op: string; table: string; row: any; id?: string }> = [];
  const plan = {
    id: 'p1',
    name: 'Pro',
    is_active: true,
    price_monthly: 10,
    price_yearly: 100,
  };
  const from = (table: string) => {
    let op = 'select';
    let row: any;
    let eqId: string | undefined;
    const q: any = {};
    q.select = () => q;
    q.insert = (r: any) => ((op = 'insert'), (row = r), q);
    q.update = (r: any) => ((op = 'update'), (row = r), q);
    q.eq = (c: string, v: string) => {
      if (c === 'id') eqId = v;
      return q;
    };
    q.in = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.single = () => run(true);
    q.then = (res: any, rej: any) => run(false).then(res, rej);
    const run = (single: boolean) => {
      if (op === 'insert' || op === 'update') {
        writes.push({ op, table, row, id: eqId });
        return Promise.resolve({ data: { id: 'new-sub', ...row }, error: null });
      }
      if (table === 'plans') return Promise.resolve({ data: plan, error: null });
      // subscriptions select (getActiveSubscription)
      return Promise.resolve({ data: existing ? [existing] : [], error: null });
    };
    return q;
  };
  return { supabase: { from }, writes };
}

const mk = (existing: any, paymentStatus: string) => {
  const { supabase, writes } = fakeSupabase(existing);
  const invoices = {
    generateInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv1' }),
    processPayment: jest.fn().mockResolvedValue({ status: paymentStatus }),
  };
  const svc = new BillingService(supabase as never, invoices as never);
  return { svc, writes, invoices };
};
const subWrites = (w: any[]) => w.filter((x) => x.table === 'subscriptions');

describe('BillingService.activateSubscription — pay first, activate after (T3)', () => {
  const args = ['t1', 'p1', BillingCycle.MONTHLY, 'o@x.test', 'T'] as const;

  it('existing sub + payment succeeded -> activated after payment', async () => {
    const { svc, writes, invoices } = mk({ id: 's1', status: 'trial' }, 'succeeded');
    await svc.activateSubscription(...args);
    expect(invoices.processPayment).toHaveBeenCalled();
    const upd = subWrites(writes).filter((w) => w.op === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0].row.status).toBe(SubscriptionStatus.ACTIVE);
    expect(upd[0].id).toBe('s1');
  });

  it('existing sub + payment failed -> subscription untouched, 402', async () => {
    const { svc, writes } = mk({ id: 's1', status: 'trial' }, 'failed');
    await expect(svc.activateSubscription(...args)).rejects.toBeInstanceOf(HttpException);
    expect(subWrites(writes)).toHaveLength(0);
  });

  it('no sub + payment failed -> placeholder is SUSPENDED then CANCELLED, never ACTIVE', async () => {
    const { svc, writes } = mk(null, 'failed');
    await expect(svc.activateSubscription(...args)).rejects.toBeInstanceOf(HttpException);
    const statuses = subWrites(writes).map((w) => w.row.status);
    expect(statuses).toEqual([SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED]);
    expect(statuses).not.toContain(SubscriptionStatus.ACTIVE);
  });

  it('no sub + payment succeeded -> placeholder promoted to ACTIVE', async () => {
    const { svc, writes } = mk(null, 'succeeded');
    await svc.activateSubscription(...args);
    const statuses = subWrites(writes).map((w) => w.row.status);
    expect(statuses).toEqual([SubscriptionStatus.SUSPENDED, SubscriptionStatus.ACTIVE]);
  });

  it('provider throwing -> placeholder abandoned, error propagates', async () => {
    const { svc, writes, invoices } = mk(null, 'succeeded');
    invoices.processPayment.mockRejectedValue(new Error('gateway down'));
    await expect(svc.activateSubscription(...args)).rejects.toThrow('gateway down');
    expect(subWrites(writes).map((w) => w.row.status)).toEqual([
      SubscriptionStatus.SUSPENDED,
      SubscriptionStatus.CANCELLED,
    ]);
  });

  it('manual (superadmin) path keeps legacy behaviour: activates even if gateway failed', async () => {
    const { svc, writes } = mk({ id: 's1', status: 'trial' }, 'failed');
    await svc.activateSubscription(...args, 50, { requirePaymentSuccess: false });
    expect(subWrites(writes).some((w) => w.row.status === SubscriptionStatus.ACTIVE)).toBe(true);
  });
});
