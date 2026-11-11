import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService.upgrade plan validation (T2)', () => {
  const tenant = { tenantId: 't1' } as never;
  const mk = (getPlanById: jest.Mock) => {
    const billing = {
      getPlanById,
      activateSubscription: jest.fn(),
      getActiveSubscription: jest.fn().mockResolvedValue(null),
    };
    const supabase = {
      from: jest.fn(() => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.is = () => q;
        q.limit = () => q;
        q.single = () =>
          Promise.resolve({
            data: { name: 'T', email: 'o@x.test' },
            error: null,
          });
        return q;
      }),
    };
    return {
      billing,
      svc: new SubscriptionsService(billing as never, supabase as never),
    };
  };

  it('rejects a deactivated plan before any financial step', async () => {
    const { svc, billing } = mk(
      jest.fn().mockResolvedValue({ id: 'p', is_active: false }),
    );
    await expect(
      svc.upgrade(tenant, { plan_id: 'p' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(billing.activateSubscription).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan', async () => {
    const { svc, billing } = mk(jest.fn().mockRejectedValue(new Error('nope')));
    await expect(
      svc.upgrade(tenant, { plan_id: 'p' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(billing.activateSubscription).not.toHaveBeenCalled();
  });

  it('proceeds for an active plan, using the caller tenant only', async () => {
    const { svc, billing } = mk(
      jest.fn().mockResolvedValue({ id: 'p', is_active: true }),
    );
    await svc.upgrade(tenant, { plan_id: 'p' } as never);
    expect(billing.activateSubscription).toHaveBeenCalledWith(
      't1',
      'p',
      expect.anything(),
      'o@x.test',
      'T',
    );
  });

  it('is idempotent: same plan/cycle already active and running -> no new charge', async () => {
    const { svc, billing } = mk(
      jest.fn().mockResolvedValue({ id: 'p', is_active: true }),
    );
    billing.getActiveSubscription.mockResolvedValue({
      status: 'active',
      plan_id: 'p',
      billing_cycle: 'monthly',
      current_period_end: new Date(Date.now() + 86400000).toISOString(),
    });
    const res = await svc.upgrade(tenant, { plan_id: 'p' } as never);
    expect(res).toEqual({ success: true, already_active: true });
    expect(billing.activateSubscription).not.toHaveBeenCalled();
  });
});
