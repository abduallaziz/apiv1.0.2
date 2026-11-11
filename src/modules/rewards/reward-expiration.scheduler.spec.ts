import { RewardExpirationScheduler } from './reward-expiration.scheduler';

describe('RewardExpirationScheduler.handleExpireRewards', () => {
  it('calls the repository sweep and logs when instances were expired', async () => {
    const instancesRepo = {
      expireDueInstances: jest.fn().mockResolvedValue(3),
    };
    const scheduler = new RewardExpirationScheduler(instancesRepo as any);
    await scheduler.handleExpireRewards();
    expect(instancesRepo.expireDueInstances).toHaveBeenCalledTimes(1);
  });

  it('is a no-op log when nothing expired', async () => {
    const instancesRepo = {
      expireDueInstances: jest.fn().mockResolvedValue(0),
    };
    const scheduler = new RewardExpirationScheduler(instancesRepo as any);
    await expect(scheduler.handleExpireRewards()).resolves.toBeUndefined();
  });
});
