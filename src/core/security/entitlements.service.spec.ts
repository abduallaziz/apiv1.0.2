import { HttpException } from '@nestjs/common';
import { EntitlementsService, Entitlements } from './entitlements.service';

function make(ent: Partial<Entitlements>) {
  const svc = new EntitlementsService({} as never);
  jest.spyOn(svc, 'get').mockResolvedValue({ locked: false, ...ent } as Entitlements);
  return svc;
}

describe('EntitlementsService.assertAccess', () => {
  const OLD = process.env.SUBSCRIPTION_ENFORCEMENT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT;
    else process.env.SUBSCRIPTION_ENFORCEMENT = OLD;
  });

  it('never locks while enforcement is off (default)', async () => {
    delete process.env.SUBSCRIPTION_ENFORCEMENT;
    await expect(make({ locked: true }).assertAccess('t1', '/invoices')).resolves.toBeUndefined();
  });

  it('locks only the listed tenants', async () => {
    process.env.SUBSCRIPTION_ENFORCEMENT = 't1, t2';
    await expect(make({ locked: true }).assertAccess('t1', '/invoices')).rejects.toBeInstanceOf(HttpException);
    await expect(make({ locked: true }).assertAccess('t9', '/invoices')).resolves.toBeUndefined();
  });

  it('answers 402 SUBSCRIPTION_LOCKED for a locked tenant', async () => {
    process.env.SUBSCRIPTION_ENFORCEMENT = 'all';
    const err = await make({ locked: true }).assertAccess('t1', '/orders').catch((e) => e as HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'SUBSCRIPTION_LOCKED' });
  });

  it('keeps the subscription / billing / auth routes reachable while locked', async () => {
    process.env.SUBSCRIPTION_ENFORCEMENT = 'all';
    const svc = make({ locked: true });
    for (const p of ['/subscriptions/current', '/api/billing/invoices', '/auth/me', '/plans', '/health']) {
      await expect(svc.assertAccess('t1', p)).resolves.toBeUndefined();
    }
  });

  it('does not touch an unlocked tenant', async () => {
    process.env.SUBSCRIPTION_ENFORCEMENT = 'all';
    await expect(make({ locked: false }).assertAccess('t1', '/orders')).resolves.toBeUndefined();
  });
});

describe('EntitlementsService counter-driven state write', () => {
  function buildSupabase(sub: Record<string, unknown>) {
    const update = jest.fn().mockReturnThis();
    const chain: Record<string, jest.Mock> = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      maybeSingle: jest.fn(),
      update,
    };
    // subscriptions list → [sub]; plan lookup → a plan; addons → []; plan_features/overrides → []
    chain.limit.mockImplementation(() => Promise.resolve({ data: [sub], error: null }));
    chain.maybeSingle.mockResolvedValue({
      data: { id: 'p1', name: 'Basic', max_users: 5, max_branches: 1 },
      error: null,
    });
    // addons/features queries resolve to empty via the thenable eq chain
    chain.eq.mockImplementation(() => chain);
    return { chain, update };
  }

  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();

  it('flips an active subscription to expired the moment its period has passed', async () => {
    const { chain, update } = buildSupabase({
      id: 's1', plan_id: 'p1', status: 'active', billing_cycle: 'monthly',
      current_period_end: past, trial_ends_at: null, grace_period_ends_at: null,
    });
    const svc = new EntitlementsService(chain as never);
    const ent = await svc.get('t1');
    expect(ent.locked).toBe(true);
    expect(ent.days_left).toBe(0);
    // A fire-and-forget update was issued to mark it expired.
    await new Promise((r) => setTimeout(r, 0));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
  });

  it('never writes while the subscription is still live', async () => {
    const { chain, update } = buildSupabase({
      id: 's2', plan_id: 'p1', status: 'active', billing_cycle: 'monthly',
      current_period_end: future, trial_ends_at: null, grace_period_ends_at: null,
    });
    const svc = new EntitlementsService(chain as never);
    const ent = await svc.get('t1');
    expect(ent.locked).toBe(false);
    expect(ent.days_left).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(update).not.toHaveBeenCalled();
  });
});
