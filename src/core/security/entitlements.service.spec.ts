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
